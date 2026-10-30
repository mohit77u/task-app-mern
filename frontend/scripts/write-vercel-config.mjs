// Writes vercel.json from BACKEND_URL so the Render address lives in a Vercel env var, not in the repo.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function buildVercelConfig(backendUrl) {
  const url = backendUrl?.trim();
  if (!url) {
    throw new Error('BACKEND_URL is required, for example https://my-service.onrender.com');
  }
  if (!/^https?:\/\/[^/]+/.test(url)) {
    throw new Error(`BACKEND_URL must start with http:// or https:// (got "${url}")`);
  }
  if (url.endsWith('/')) {
    throw new Error('BACKEND_URL must not have a trailing slash');
  }
  if (/\/api$/.test(url)) {
    throw new Error('BACKEND_URL must not end with /api; the rewrite adds it');
  }
  return {
    rewrites: [
      { source: '/api/:path*', destination: `${url}/api/:path*` },
      { source: '/((?!api/).*)', destination: '/index.html' },
    ],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const config = buildVercelConfig(process.env.BACKEND_URL);
    writeFileSync(new URL('../vercel.json', import.meta.url), `${JSON.stringify(config, null, 2)}\n`);
    console.log(`vercel.json written, /api proxies to ${process.env.BACKEND_URL.trim()}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
