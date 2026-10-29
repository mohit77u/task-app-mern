import { notDeleted } from '../../common/db/soft-delete';
import { parseObjectId } from '../../common/utils/object-id';
import { UserModel, type IRole, type IUser } from '../../models';

export interface ActiveUser {
  user: IUser;
  role: IRole;
}

/**
 * Loads a non-deleted user together with their role, or null. One query (plus the populate) per call; there is
 * deliberately no cache, so a deleted or demoted user is refused on the very next request.
 */
export async function findActiveUserWithRole(
  id: string,
): Promise<ActiveUser | null> {
  const _id = parseObjectId(id);
  if (!_id) return null;
  const row = await UserModel.findOne(notDeleted({ _id }))
    .populate<{ roleId: IRole | null }>('roleId')
    .lean();
  if (!row?.roleId) return null;
  const role = row.roleId;
  return { user: { ...row, roleId: role._id }, role };
}
