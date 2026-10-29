/** The one place that decides what "not deleted" means; every query filter goes through it. */
export function notDeleted<T extends object>(
  filter?: T,
): T & { deletedAt: null } {
  return { ...(filter ?? ({} as T)), deletedAt: null };
}
