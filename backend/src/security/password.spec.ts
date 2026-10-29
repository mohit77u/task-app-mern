import { hashPassword, verifyDummyPassword, verifyPassword } from './password';

describe('password', () => {
  it('hashes with bcrypt and verifies the original password only', async () => {
    const hash = await hashPassword('Secret#123');
    expect(hash).not.toContain('Secret#123');
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    await expect(verifyPassword('Secret#123', hash)).resolves.toBe(true);
    await expect(verifyPassword('secret#123', hash)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same'),
      hashPassword('same'),
    ]);
    expect(a).not.toBe(b);
  });

  it('verifyDummyPassword burns a comparison without a real hash', async () => {
    await expect(verifyDummyPassword('anything')).resolves.toBeUndefined();
  });
});
