import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { errorHandler } from '../errors/error-handler';
import { requestId } from '../middleware/request-id';
import { validate } from './validate';
import {
  dateOnlyString,
  emailString,
  objectIdParam,
  objectIdString,
} from './primitives';

const schema = z.object({
  name: z.string().min(1),
  n: z.coerce.number().int().optional(),
});

function app(): express.Express {
  const a = express();
  a.use(requestId);
  a.use(express.json());
  a.post('/b', validate(schema, 'body'), (_req, res) => {
    res.json(res.locals.body);
  });
  a.get('/q', validate(schema, 'query'), (_req, res) => {
    res.json(res.locals.query);
  });
  a.get(
    '/p/:id',
    validate(z.object({ id: objectIdParam }), 'params'),
    (_req, res) => {
      res.json(res.locals.params);
    },
  );
  a.use(errorHandler);
  return a;
}

describe('validate', () => {
  it('passes parsed (coerced) data on res.locals', async () => {
    const res = await request(app()).get('/q').query({ name: 'a', n: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'a', n: 3 });
  });

  it('rejects an unknown body key with 422 and details[0].field set to that key', async () => {
    const res = await request(app()).post('/b').send({ name: 'a', extra: 1 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details[0].field).toBe('extra');
  });

  it('rejects an unknown query key', async () => {
    const res = await request(app()).get('/q').query({ name: 'a', bogus: '1' });
    expect(res.status).toBe(422);
    expect(res.body.details[0].field).toBe('bogus');
  });

  it('reports the field path of a failed rule', async () => {
    const res = await request(app()).post('/b').send({ name: '' });
    expect(res.status).toBe(422);
    expect(res.body.details[0].field).toBe('name');
  });

  it('treats a missing body as an empty object', async () => {
    const res = await request(app()).post('/b');
    expect(res.status).toBe(422);
    expect(res.body.details[0].field).toBe('name');
  });

  it('passes a valid path id on res.locals.params', async () => {
    const id = '507f1f77bcf86cd799439011';
    const res = await request(app()).get(`/p/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id });
  });

  it.each(['123', 'not-an-id', '123456789012'])(
    'answers 404 NOT_FOUND for malformed path id %s',
    async (bad) => {
      const res = await request(app()).get(`/p/${bad}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: expect.any(String),
        details: [],
        requestId: expect.any(String),
        timestamp: expect.any(String),
        path: `/p/${bad}`,
      });
    },
  );

  it('answers 422 with the field for a malformed id in a body', async () => {
    const a = express();
    a.use(requestId);
    a.use(express.json());
    a.post(
      '/t',
      validate(z.object({ assigneeId: objectIdString }), 'body'),
      (_q, r) => {
        r.json({});
      },
    );
    a.use(errorHandler);
    const res = await request(a).post('/t').send({ assigneeId: '123' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details[0].field).toBe('assigneeId');
  });
});

describe('primitives', () => {
  it('dateOnlyString accepts real dates only', () => {
    expect(dateOnlyString.safeParse('2026-02-28').success).toBe(true);
    expect(dateOnlyString.safeParse('2026-02-30').success).toBe(false);
    expect(dateOnlyString.safeParse('2026-2-3').success).toBe(false);
  });

  it('emailString trims and lowercases', () => {
    expect(emailString.parse('  A@B.Com ')).toBe('a@b.com');
    expect(emailString.safeParse('nope').success).toBe(false);
  });
});
