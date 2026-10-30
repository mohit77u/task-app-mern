import express from 'express';
import request from 'supertest';
import { createServerlessHandler } from './serverless';

function okApp() {
  const app = express();
  app.get('/api/ping', (_req, res) => {
    res.json({ pong: true });
  });
  return app;
}

describe('createServerlessHandler', () => {
  it('initialises once and reuses the app for later requests', async () => {
    const load = jest.fn(() => Promise.resolve(okApp()));
    const server = express().use(createServerlessHandler(load));
    await request(server).get('/api/ping').expect(200);
    await request(server).get('/api/ping').expect(200, { pong: true });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('answers 503 without leaking the error, and retries init on the next request', async () => {
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error('mongodb+srv://u:secret@h failed'))
      .mockResolvedValue(okApp());
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const server = express().use(createServerlessHandler(load));
    const failed = await request(server).get('/api/ping').expect(503);
    expect(JSON.stringify(failed.body)).not.toContain('secret');
    await request(server).get('/api/ping').expect(200);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
