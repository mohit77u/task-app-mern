import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import type { Env } from '../../config/env.validation';
import { RefreshTokenModel, type IRefreshToken } from '../../models';
import {
  generateRefreshToken,
  hashRefreshToken,
} from '../../security/refresh-token-util';

export interface ClientMeta {
  userAgent?: string;
  ip?: string;
}

export type RotationResult =
  | { kind: 'rotated'; userId: string; token: string }
  | { kind: 'grace'; userId: string }
  | { kind: 'reuse' }
  | { kind: 'invalid' };

/** How long a just-rotated token is still honoured, so two tabs refreshing at once do not look like token theft. */
export const REFRESH_GRACE_MS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const REVOKED_RETENTION_MS = 7 * DAY_MS;
/** Upper bound on the rotation-chain walk; a live chain is never this long inside a 10 s window. */
const MAX_CHAIN_HOPS = 10;

export class RefreshTokenService {
  /** `now` is injectable so tests can move past the grace window without fake timers (which stall the driver). */
  constructor(
    private readonly env: Env,
    private readonly now: () => number = Date.now,
  ) {}

  /** Starts a new token family for a fresh login and tidies the user's stale rows. */
  async issueForLogin(userId: string, meta: ClientMeta): Promise<string> {
    const owner = new Types.ObjectId(userId);
    await this.prune(owner);
    const { token } = await this.create(owner, randomUUID(), meta);
    return token;
  }

  /**
   * Exchanges a refresh token for its successor without a transaction. Atomicity comes from one conditional
   * `findOneAndUpdate` claim on the presented row (`revokedAt: null` and not expired): of any number of concurrent
   * callers exactly one can flip `revokedAt`, so exactly one gets `rotated`.
   *
   * The successor is written BEFORE the claim and the claim sets `revokedAt` and `replacedById` together. So:
   *  - a loser that re-reads the row always finds `replacedById` pointing at a successor that already exists, and gets
   *    `grace` rather than a false reuse alarm;
   *  - a logout (family revoke) racing the rotation also revokes the successor, because it is already in the family;
   *    written after the claim, it could have been inserted live after the logout and outlived it.
   * A loser deletes its unused successor. Its raw value was never returned, so a crash before that delete leaves only
   * an unreferenced row nobody can present, which expires like any other.
   */
  async rotate(presented: string, meta: ClientMeta): Promise<RotationResult> {
    const tokenHash = hashRefreshToken(presented);
    const now = new Date(this.now());

    const row = await RefreshTokenModel.findOne({ tokenHash }).lean();
    if (!row || row.expiresAt <= now) return { kind: 'invalid' };
    if (row.revokedAt) return this.decideRevoked(row, row.revokedAt, now);

    const next = await this.create(row.userId, row.familyId, meta);
    const claimed = await RefreshTokenModel.findOneAndUpdate(
      { tokenHash, revokedAt: null, expiresAt: { $gt: now } },
      { $set: { revokedAt: now, replacedById: next.id } },
    ).lean();
    if (claimed) {
      return {
        kind: 'rotated',
        userId: claimed.userId.toHexString(),
        token: next.token,
      };
    }

    // Someone else claimed (or revoked) the row between our read and our claim.
    await RefreshTokenModel.deleteOne({ _id: next.id });
    const current = await RefreshTokenModel.findOne({ tokenHash }).lean();
    if (!current?.revokedAt) return { kind: 'invalid' };
    return this.decideRevoked(current, current.revokedAt, now);
  }

  /** Logout: kills the presented token's whole family so no sibling token can resurrect the session. */
  async revokeFamilyOf(presented: string): Promise<void> {
    const row = await RefreshTokenModel.findOne({
      tokenHash: hashRefreshToken(presented),
    }).lean();
    if (!row) return;
    await this.revokeFamily(row.familyId, new Date(this.now()));
  }

  /**
   * A revoked token was presented. Inside the grace window after a rotation, and while the session it was rotated into
   * is still alive, it is a concurrent refresh from another tab: answer `grace`. Anything else means a stolen token is
   * being replayed, so the whole family is revoked.
   */
  private async decideRevoked(
    row: IRefreshToken,
    revokedAt: Date,
    now: Date,
  ): Promise<RotationResult> {
    const rotatedRecently =
      row.replacedById !== null &&
      now.getTime() - revokedAt.getTime() <= REFRESH_GRACE_MS;
    if (rotatedRecently && (await this.isSessionAlive(row.replacedById, now))) {
      return { kind: 'grace', userId: row.userId.toHexString() };
    }
    await this.revokeFamily(row.familyId, now);
    return { kind: 'reuse' };
  }

  /**
   * The grace window only exists for two tabs refreshing together. It must not outlive the session: after logout, a
   * password reset or a reuse alarm the newest token of the chain is revoked, and an older token must not mint access.
   * Walks the rotation chain to its newest token and checks that one is still usable.
   */
  private async isSessionAlive(
    successorId: Types.ObjectId | null,
    now: Date,
  ): Promise<boolean> {
    let currentId = successorId;
    for (let hops = 0; currentId !== null && hops < MAX_CHAIN_HOPS; hops += 1) {
      const token = await RefreshTokenModel.findById(currentId).lean();
      if (!token) return false;
      if (!token.revokedAt) return token.expiresAt > now;
      currentId = token.replacedById;
    }
    return false;
  }

  private async revokeFamily(familyId: string, now: Date): Promise<void> {
    await RefreshTokenModel.updateMany(
      { familyId, revokedAt: null },
      { $set: { revokedAt: now } },
    );
  }

  private async create(
    userId: Types.ObjectId,
    familyId: string,
    meta: ClientMeta,
  ): Promise<{ token: string; id: Types.ObjectId }> {
    const { token, hash } = generateRefreshToken();
    const doc = await RefreshTokenModel.create({
      userId,
      familyId,
      tokenHash: hash,
      expiresAt: new Date(
        this.now() + this.env.REFRESH_TOKEN_TTL_DAYS * DAY_MS,
      ),
      revokedAt: null,
      replacedById: null,
      userAgent: meta.userAgent?.slice(0, 255) ?? null,
      ip: meta.ip?.slice(0, 64) ?? null,
    });
    return { token, id: doc._id };
  }

  /** Deletes expired rows and rows revoked long ago. Recently revoked rows stay so reuse detection keeps working. */
  private async prune(userId: Types.ObjectId): Promise<void> {
    const now = this.now();
    await RefreshTokenModel.deleteMany({
      userId,
      $or: [
        { expiresAt: { $lt: new Date(now) } },
        { revokedAt: { $lt: new Date(now - REVOKED_RETENTION_MS) } },
      ],
    });
  }
}
