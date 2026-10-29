import express, { type Express } from 'express';
import { Error as MongooseError } from 'mongoose';
import request from 'supertest';
import { requestId } from '../middleware/request-id';
import { AppException } from './app.exception';
import { errorHandler, notFoundHandler } from './error-handler';

function buildApp(thrower?: () => never): Express {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.post('/echo', (req, res) => {
    res.json(req.body);
  });
  app.get('/boom', () => {
    if (thrower) thrower();
  });
  app.get('/async', async () => {
    await Promise.resolve();
    if (thrower) thrower();
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const bodyShape = {
  statusCode: expect.any(Number),
  code: expect.any(String),
  message: expect.any(String),
  details: expect.any(Array),
  requestId: expect.any(String),
  timestamp: expect.any(String),
  path: expect.any(String),
};

describe('errorHandler', () => {
  it('renders an AppException with the full contract body', async () => {
    const res = await request(
      buildApp(() => {
        throw AppException.forbidden();
      }),
    ).get('/boom');
    expect(res.status).toBe(403);
    expect(res.body).toEqual(bodyShape);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(res.body.path).toBe('/boom');
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('propagates errors from async handlers (Express 5)', async () => {
    const res = await request(
      buildApp(() => {
        throw AppException.conflict('dup');
      }),
    ).get('/async');
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('dup');
  });

  it('turns an unknown Error into a 500 without leaking its message, and logs it with the request id', async () => {
    const spy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const res = await request(
      buildApp(() => {
        throw new Error('boom secret detail');
      }),
    ).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual(bodyShape);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secret detail');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain(res.body.requestId);
    spy.mockRestore();
  });

  it('maps a duplicate-key error (11000) to 409 CONFLICT', async () => {
    const res = await request(
      buildApp(() => {
        throw Object.assign(new Error('E11000 dup key'), { code: 11000 });
      }),
    ).get('/boom');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
    expect(JSON.stringify(res.body)).not.toContain('E11000');
  });

  it('maps a CastError on _id to 404 NOT_FOUND (malformed id in a path)', async () => {
    const res = await request(
      buildApp(() => {
        throw new MongooseError.CastError('ObjectId', 'not-an-id', '_id');
      }),
    ).get('/boom');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('maps a CastError of kind ObjectId on another path to 404', async () => {
    const res = await request(
      buildApp(() => {
        throw new MongooseError.CastError('ObjectId', 'x', 'assigneeId');
      }),
    ).get('/boom');
    expect(res.status).toBe(404);
  });

  it('maps other CastErrors to 422 VALIDATION_ERROR with the field', async () => {
    const res = await request(
      buildApp(() => {
        throw new MongooseError.CastError('Number', 'abc', 'age');
      }),
    ).get('/boom');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details[0].field).toBe('age');
  });

  it('maps a Mongoose ValidationError to 422', async () => {
    const res = await request(
      buildApp(() => {
        const err = new MongooseError.ValidationError();
        err.addError(
          'title',
          new MongooseError.ValidatorError({
            path: 'title',
            message: 'Title is required',
          }),
        );
        throw err;
      }),
    ).get('/boom');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details).toEqual([
      { field: 'title', message: 'Title is required' },
    ]);
  });

  it('maps malformed JSON to 400 VALIDATION_ERROR without echoing the parser message', async () => {
    const res = await request(buildApp())
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"a": ');
    expect(res.status).toBe(400);
    expect(res.body).toEqual(bodyShape);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toBe('Request body is not valid JSON');
  });

  it('maps an oversized body to 413 VALIDATION_ERROR', async () => {
    const app = express();
    app.use(requestId);
    app.use(express.json({ limit: '10b' }));
    app.post('/echo', (_req, res) => {
      res.json({});
    });
    app.use(errorHandler);
    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ a: 'x'.repeat(100) }));
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('maps an unsupported charset to 415 VALIDATION_ERROR', async () => {
    const res = await request(buildApp())
      .post('/echo')
      .set('Content-Type', 'application/json; charset=latin1')
      .send('{}');
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('sets Retry-After for rate-limited errors', async () => {
    const res = await request(
      buildApp(() => {
        throw AppException.rateLimited(42);
      }),
    ).get('/boom');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('42');
    expect(res.body.code).toBe('RATE_LIMITED');
  });
});

describe('notFoundHandler', () => {
  it('returns 404 NOT_FOUND with a request id', async () => {
    const res = await request(buildApp()).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual(bodyShape);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.requestId).toBeTruthy();
  });
});
