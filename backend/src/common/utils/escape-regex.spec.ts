import { escapeRegex } from './escape-regex';

describe('escapeRegex', () => {
  it('makes metacharacters match literally', () => {
    const escaped = escapeRegex('a.*(b)');
    const re = new RegExp(escaped);
    expect(re.test('a.*(b)')).toBe(true);
    expect(re.test('aXXXb')).toBe(false);
    expect(re.test('a(b)')).toBe(false);
  });

  it.each(['(', '[', '.*', '\\', '+?', '{1}', '^$|'])(
    'does not throw on %s',
    (s) => {
      expect(() => new RegExp(escapeRegex(s))).not.toThrow();
      expect(new RegExp(`^${escapeRegex(s)}$`).test(s)).toBe(true);
    },
  );
});
