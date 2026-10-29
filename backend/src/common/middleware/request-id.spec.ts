import express from 'express';
import request from 'supertest';
import { requestId } from './request-id';

function app(): express.Express {
  const a = express();
  a.use(requestId);
  a.get('/', (req, res) => {
    res.json({ id: req.id });
  });
  return a;
}

describe('requestId', () => {
  it('generates a uuid and echoes it in X-Request-Id', async () => {
    const res = await request(app()).get('/');
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-request-id']).toBe(res.body.id);
  });

  it('honours a sane incoming id and replaces an oversized one', async () => {
    const ok = await request(app()).get('/').set('X-Request-Id', 'abc-123');
    expect(ok.body.id).toBe('abc-123');
    const big = await request(app())
      .get('/')
      .set('X-Request-Id', 'x'.repeat(129));
    expect(big.body.id).not.toBe('x'.repeat(129));
  });

  it.each([
    'has space',
    'semi;colon',
    'new\u0020line'.replace(' ', '!'),
    'x'.repeat(129),
  ])('replaces a non-conforming incoming id %p', async (bad) => {
    const res = await request(app()).get('/').set('X-Request-Id', bad);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
