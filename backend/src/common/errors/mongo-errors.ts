import { Error as MongooseError } from 'mongoose';
import { AppException } from './app.exception';

/** MongoServerError code for a unique-index violation. */
const DUPLICATE_KEY = 11000;

export function hasDuplicateKeyCode(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY
  );
}

/**
 * Maps the persistence-layer errors that are really client mistakes onto the public contract. Returns undefined for
 * anything else so the caller reports it as an internal error.
 */
export function fromMongoError(error: unknown): AppException | undefined {
  if (hasDuplicateKeyCode(error)) {
    return AppException.conflict('Resource already exists');
  }
  if (error instanceof MongooseError.CastError) {
    // A malformed id in a path is "no such record", not a server fault.
    if (error.path === '_id' || error.kind === 'ObjectId') {
      return AppException.notFound();
    }
    return AppException.validation([
      { field: error.path, message: `Invalid value for ${error.path}` },
    ]);
  }
  if (error instanceof MongooseError.ValidationError) {
    return AppException.validation(
      Object.entries(error.errors).map(([field, e]) => ({
        field,
        message: e.message,
      })),
    );
  }
  return undefined;
}
