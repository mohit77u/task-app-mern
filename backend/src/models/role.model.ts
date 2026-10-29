import { Schema, model, type Types } from 'mongoose';

export interface IRole {
  _id: Types.ObjectId;
  code: string;
  name: string;
  createdAt: Date;
}

const roleSchema = new Schema<IRole>(
  {
    code: { type: String, required: true, maxlength: 32, unique: true },
    name: { type: String, required: true, maxlength: 64 },
  },
  { collection: 'roles', timestamps: { createdAt: true, updatedAt: false } },
);

export const RoleModel = model<IRole>('Role', roleSchema);
