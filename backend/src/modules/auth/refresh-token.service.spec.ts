import { Types } from 'mongoose';
import {
  clearTestDb,
  startTestDb,
  stopTestDb,
  testEnv,
} from '../../../test/mongo';
import { ensureIndexes, RefreshTokenModel } from '../../models';
import { hashRefreshToken } from '../../security/refresh-token-util';
import {
  REFRESH_GRACE_MS,
  RefreshTokenService,
  type RotationResult,
} from './refresh-token.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const meta = { userAgent: 'jest', ip: '127.0.0.1' };

describe('RefreshTokenService', () => {
  const env = testEnv();
  let clock: number;
  let service: RefreshTokenService;
  let userId: string;

  beforeAll(async () => {
    await startTestDb();
    await ensureIndexes();
  });
  afterAll(stopTestDb);
  beforeEach(async () => {
    await clearTestDb();
    clock = Date.now();
    service = new RefreshTokenService(env, () => clock);
    userId = new Types.ObjectId().toHexString();
  });

  async function rowOf(token: string) {
    const row = await RefreshTokenModel.findOne({
      tokenHash: hashRefreshToken(token),
    }).lean();
    if (!row) throw new Error('row not found');
    return row;
  }

  function rotatedToken(result: RotationResult): string {
    if (result.kind !== 'rotated')
      throw new Error(`expected rotated, got ${result.kind}`);
    return result.token;
  }

  it('issueForLogin stores only the SHA-256 hash of the token, with the TTL and client meta', async () => {
    const token = await service.issueForLogin(userId, meta);
    const rows = await RefreshTokenModel.find().lean();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.tokenHash).toBe(hashRefreshToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.userId.toHexString()).toBe(userId);
    expect(row.revokedAt).toBeNull();
    expect(row.replacedById).toBeNull();
    expect(row.expiresAt.getTime()).toBe(
      clock + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS,
    );
    expect(row.userAgent).toBe('jest');
    expect(row.ip).toBe('127.0.0.1');
  });

  it('each login starts a new family', async () => {
    const a = await rowOf(await service.issueForLogin(userId, meta));
    const b = await rowOf(await service.issueForLogin(userId, meta));
    expect(a.familyId).not.toBe(b.familyId);
  });

  it('rotate returns a new token and marks the old row revoked with replacedById', async () => {
    const t1 = await service.issueForLogin(userId, meta);
    const result = await service.rotate(t1, meta);
    expect(result).toEqual({
      kind: 'rotated',
      userId,
      token: expect.any(String),
    });
    const t2 = rotatedToken(result);
    expect(t2).not.toBe(t1);

    const old = await rowOf(t1);
    const next = await rowOf(t2);
    expect(old.revokedAt?.getTime()).toBe(clock);
    expect(old.replacedById?.toHexString()).toBe(next._id.toHexString());
    expect(next.familyId).toBe(old.familyId);
    expect(next.revokedAt).toBeNull();
    expect(await RefreshTokenModel.countDocuments()).toBe(2);
  });

  it('the same token again inside the grace window returns grace (no new token)', async () => {
    const t1 = await service.issueForLogin(userId, meta);
    rotatedToken(await service.rotate(t1, meta));
    clock += REFRESH_GRACE_MS;
    expect(await service.rotate(t1, meta)).toEqual({ kind: 'grace', userId });
    expect(await RefreshTokenModel.countDocuments()).toBe(2);
  });

  it('the same token after the grace window is reuse and revokes the whole family', async () => {
    const t1 = await service.issueForLogin(userId, meta);
    const t2 = rotatedToken(await service.rotate(t1, meta));
    const t3 = rotatedToken(await service.rotate(t2, meta));
    const otherFamily = await service.issueForLogin(userId, meta);

    clock += REFRESH_GRACE_MS + 1;
    expect(await service.rotate(t1, meta)).toEqual({ kind: 'reuse' });

    expect((await rowOf(t3)).revokedAt).not.toBeNull();
    expect(
      await RefreshTokenModel.countDocuments({
        familyId: (await rowOf(t1)).familyId,
        revokedAt: null,
      }),
    ).toBe(0);
    expect((await rowOf(otherFamily)).revokedAt).toBeNull();
    // The newest token is dead too.
    expect(await service.rotate(t3, meta)).toEqual({ kind: 'reuse' });
  });

  it('an unknown token is invalid', async () => {
    expect(await service.rotate('no-such-token', meta)).toEqual({
      kind: 'invalid',
    });
  });

  it('an expired token is invalid and rotates nothing', async () => {
    const t1 = await service.issueForLogin(userId, meta);
    clock += env.REFRESH_TOKEN_TTL_DAYS * DAY_MS;
    expect(await service.rotate(t1, meta)).toEqual({ kind: 'invalid' });
    expect((await rowOf(t1)).revokedAt).toBeNull();
    expect(await RefreshTokenModel.countDocuments()).toBe(1);
  });

  it('two concurrent rotations of the same token yield exactly one rotated and one grace', async () => {
    for (let round = 0; round < 15; round += 1) {
      const t = await service.issueForLogin(userId, meta);
      const results = await Promise.all([
        service.rotate(t, meta),
        service.rotate(t, meta),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual(['grace', 'rotated']);
      const family = (await rowOf(t)).familyId;
      // Exactly one successor survives; the loser left no orphan behind.
      expect(await RefreshTokenModel.countDocuments({ familyId: family })).toBe(
        2,
      );
      expect(
        await RefreshTokenModel.countDocuments({
          familyId: family,
          revokedAt: null,
        }),
      ).toBe(1);
    }
  });

  it('revokeFamilyOf revokes every token of the family and nothing else', async () => {
    const t1 = await service.issueForLogin(userId, meta);
    const t2 = rotatedToken(await service.rotate(t1, meta));
    const other = await service.issueForLogin(userId, meta);

    await service.revokeFamilyOf(t1);

    expect((await rowOf(t2)).revokedAt).not.toBeNull();
    expect((await rowOf(other)).revokedAt).toBeNull();
    expect(await service.rotate(t2, meta)).toEqual({ kind: 'reuse' });
  });

  it('revokeFamilyOf ignores an unknown token', async () => {
    const t1 = await service.issueForLogin(userId, meta);
    await service.revokeFamilyOf('unknown');
    expect((await rowOf(t1)).revokedAt).toBeNull();
  });

  it('refuses grace once the newest token of the chain is revoked (logout), treating it as reuse', async () => {
    const t1 = await service.issueForLogin(userId, meta);
    const t2 = rotatedToken(await service.rotate(t1, meta));
    await service.revokeFamilyOf(t2);
    expect(await service.rotate(t1, meta)).toEqual({ kind: 'reuse' });
  });

  it('walks the chain to its newest token when deciding grace', async () => {
    const t1 = await service.issueForLogin(userId, meta);
    const t2 = rotatedToken(await service.rotate(t1, meta));
    rotatedToken(await service.rotate(t2, meta));
    expect(await service.rotate(t1, meta)).toEqual({ kind: 'grace', userId });
  });

  it('issueForLogin prunes rows expired or revoked over 7 days ago, for that user only', async () => {
    const otherUser = new Types.ObjectId();
    const base = {
      userId: new Types.ObjectId(userId),
      familyId: 'f',
      expiresAt: new Date(clock + DAY_MS),
    };
    let n = 0;
    const row = (overrides: Record<string, unknown>) => ({
      ...base,
      tokenHash: `hash-${(n += 1)}`,
      ...overrides,
    });
    await RefreshTokenModel.create([
      row({ tokenHash: 'expired', expiresAt: new Date(clock - 1000) }),
      row({
        tokenHash: 'old-revoked',
        revokedAt: new Date(clock - 8 * DAY_MS),
      }),
      row({
        tokenHash: 'recent-revoked',
        revokedAt: new Date(clock - 6 * DAY_MS),
      }),
      row({ tokenHash: 'live' }),
      row({
        tokenHash: 'other-expired',
        userId: otherUser,
        expiresAt: new Date(clock - 1000),
      }),
      row({
        tokenHash: 'other-old-revoked',
        userId: otherUser,
        revokedAt: new Date(clock - 8 * DAY_MS),
      }),
    ]);

    await service.issueForLogin(userId, meta);

    const remaining = (await RefreshTokenModel.find().lean()).map(
      (r) => r.tokenHash,
    );
    expect(remaining).not.toContain('expired');
    expect(remaining).not.toContain('old-revoked');
    expect(remaining).toEqual(
      expect.arrayContaining([
        'recent-revoked',
        'live',
        'other-expired',
        'other-old-revoked',
      ]),
    );
    expect(remaining).toHaveLength(5);
  });
});
