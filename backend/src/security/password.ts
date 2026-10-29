import bcrypt from 'bcrypt';

/** bcrypt work factor. 12 is ~250ms on commodity hardware: slow enough to hurt brute force, fine for login. */
export const BCRYPT_COST = 12;

/** Computed lazily, once, so a login for an unknown email costs the same as one for a known email. */
let dummyHash: Promise<string> | undefined;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Burns the same time as a real comparison so response timing does not reveal which emails exist. */
export async function verifyDummyPassword(plain: string): Promise<void> {
  dummyHash ??= bcrypt.hash('not-a-real-password', BCRYPT_COST);
  await bcrypt.compare(plain, await dummyHash);
}
