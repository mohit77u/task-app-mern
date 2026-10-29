const MONGO_URI = /mongodb(\+srv)?:\/\/[^\s'"]+/g;

/** Driver errors can echo the connection string, credentials and all; strip it before anything is logged. */
export function redactMongoUri(message: string): string {
  return message.replace(
    MONGO_URI,
    (_match, srv: string | undefined) => `mongodb${srv ?? ''}://<redacted>`,
  );
}
