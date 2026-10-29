import express from 'express';
import request from 'supertest';
import { errorHandler } from '../errors/error-handler';
import { requestId } from './request-id';
import { originCheck } from './origin';

function app(): express.Express {
  const a = express();
  a.use(requestId);
  a.use(originCheck(['http://localhost:5173']));
  a.all('/x', (_req, res) => {
    res.json({ ok: true });
  });
  a.use(errorHandler);
  return a;
}

describe('originCheck', () => {
  it('allows requests without an Origin header', async () => {
    expect((await request(app()).post('/x')).status).toBe(200);
  });

  it('allows a listed origin on writes', async () => {
    const res = await request(app())
      .post('/x')
      .set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(200);
  });

  it.each(['post', 'put', 'patch', 'delete'] as const)(
    'rejects an unlisted origin on %s with 403 FORBIDDEN',
    async (method) => {
      const res = await request(app())
        [method]('/x')
        .set('Origin', 'http://evil.example');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    },
  );

  it('allows an unlisted origin on GET', async () => {
    const res = await request(app())
      .get('/x')
      .set('Origin', 'http://evil.example');
    expect(res.status).toBe(200);
  });
});
