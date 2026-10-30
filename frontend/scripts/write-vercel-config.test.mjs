import { describe, expect, it } from 'vitest';
import { buildVercelConfig } from './write-vercel-config.mjs';

describe('buildVercelConfig', () => {
  it('throws when BACKEND_URL is missing or blank', () => {
    expect(() => buildVercelConfig(undefined)).toThrow(/BACKEND_URL/);
    expect(() => buildVercelConfig('  ')).toThrow(/BACKEND_URL/);
  });

  it('rejects a trailing slash', () => {
    expect(() => buildVercelConfig('https://api.onrender.com/')).toThrow(/trailing slash/);
  });

  it('rejects an /api suffix', () => {
    expect(() => buildVercelConfig('https://api.onrender.com/api')).toThrow(/\/api/);
  });

  it('rejects a value that is not an http(s) URL', () => {
    expect(() => buildVercelConfig('api.onrender.com')).toThrow(/http/);
  });

  it('produces the api proxy and the SPA fallback rewrites', () => {
    expect(buildVercelConfig('https://api.onrender.com')).toEqual({
      rewrites: [
        { source: '/api/:path*', destination: 'https://api.onrender.com/api/:path*' },
        { source: '/((?!api/).*)', destination: '/index.html' },
      ],
    });
  });
});
