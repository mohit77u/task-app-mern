import { parseObjectId } from './object-id';

describe('parseObjectId', () => {
  it.each(['abc', '123', '', 'zzzzzzzzzzzzzzzzzzzzzzzz', '123456789012'])(
    'returns null for %p',
    (v) => {
      expect(parseObjectId(v)).toBeNull();
    },
  );

  it('parses a 24-hex id', () => {
    const id = '507f1f77bcf86cd799439011';
    expect(parseObjectId(id)?.toHexString()).toBe(id);
  });
});
