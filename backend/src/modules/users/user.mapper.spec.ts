import { Types } from 'mongoose';
import { toUserResponse } from './user.mapper';

describe('toUserResponse', () => {
  it('maps ids to strings and never exposes the password hash', () => {
    const userId = new Types.ObjectId();
    const roleId = new Types.ObjectId();
    const user = {
      _id: userId,
      name: 'Ann',
      email: 'ann@example.com',
      phone: null,
      isDefault: true,
      passwordHash: 'secret-hash',
      roleId,
    };
    const role = { _id: roleId, code: 'ADMIN', name: 'Administrator' };

    const response = toUserResponse(user, role);

    expect(response).toEqual({
      id: userId.toHexString(),
      name: 'Ann',
      email: 'ann@example.com',
      phone: null,
      isDefault: true,
      role: { id: roleId.toHexString(), code: 'ADMIN', name: 'Administrator' },
    });
    expect(JSON.stringify(response)).not.toContain('secret-hash');
  });
});
