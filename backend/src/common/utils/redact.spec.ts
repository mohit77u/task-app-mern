import { redactMongoUri } from './redact';

describe('redactMongoUri', () => {
  it('replaces every mongodb:// and mongodb+srv:// URI, credentials included', () => {
    const message =
      'connect failed for mongodb+srv://user:s3cret@cluster0.abc.mongodb.net/app?retryWrites=true and mongodb://a:b@host:27017/x';
    const redacted = redactMongoUri(message);
    expect(redacted).toBe(
      'connect failed for mongodb+srv://<redacted> and mongodb://<redacted>',
    );
    expect(redacted).not.toContain('s3cret');
  });

  it('leaves messages without a URI untouched', () => {
    expect(redactMongoUri('querySrv ENOTFOUND')).toBe('querySrv ENOTFOUND');
  });
});
