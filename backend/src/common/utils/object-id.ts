import { Types } from 'mongoose';

/** Strict: only a 24-char hex string (Types.ObjectId.isValid also accepts any 12-char string). */
export function parseObjectId(value: string): Types.ObjectId | null {
  return /^[0-9a-fA-F]{24}$/.test(value) ? new Types.ObjectId(value) : null;
}
