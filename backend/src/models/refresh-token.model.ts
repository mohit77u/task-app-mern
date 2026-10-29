import { Schema, model, type Types } from 'mongoose';

export interface IRefreshToken {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** All tokens descending from one login share a family so reuse of a rotated token can revoke the chain. */
  familyId: string;
  /** SHA-256 of the token; the raw value exists only in the user's cookie. */
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: Types.ObjectId | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    familyId: { type: String, required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedById: {
      type: Schema.Types.ObjectId,
      ref: 'RefreshToken',
      default: null,
    },
    userAgent: { type: String, default: null, maxlength: 255 },
    ip: { type: String, default: null, maxlength: 64 },
  },
  { collection: 'refreshtokens', timestamps: true },
);

refreshTokenSchema.index({ familyId: 1 });
// Slack beyond expiry so the TTL monitor never removes a row inside the 7-day revoked-retention rule.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 30 * 86400 });

export const RefreshTokenModel = model<IRefreshToken>(
  'RefreshToken',
  refreshTokenSchema,
);
