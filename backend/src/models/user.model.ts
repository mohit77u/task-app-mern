import { Schema, model, type Types } from 'mongoose';

export interface IUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  phone: string | null;
  isDefault: boolean;
  deletedAt: Date | null;
  passwordHash: string;
  passwordChangedAt: Date | null;
  roleId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      maxlength: 255,
      trim: true,
      lowercase: true,
      set: (v: unknown): unknown =>
        typeof v === 'string' ? v.trim().toLowerCase() : v,
      unique: true,
    },
    phone: { type: String, default: null, maxlength: 20 },
    isDefault: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    passwordHash: { type: String, required: true, maxlength: 255 },
    passwordChangedAt: { type: Date, default: null },
    roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
  },
  { collection: 'users', timestamps: true },
);

export const UserModel = model<IUser>('User', userSchema);
