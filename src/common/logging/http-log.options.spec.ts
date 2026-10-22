import express from 'express';
import pinoHttp from 'pino-http';
import request from 'supertest';
import { Writable } from 'node:stream';
import { buildHttpLogOptions } from './http-log.options';

describe('buildHttpLogOptions', () => {
  function build() {
    const lines: Record<string, any>[] = [];
    const stream = new Writable({
      write(chunk, _enc, done) {
        lines.push(JSON.parse(chunk.toString()));
        done();
      },
    });
    const options = buildHttpLogOptions({ level: 'debug', format: 'json', appEnv: 'staging' });
    const app = express();
    app.use(pinoHttp({ ...options, stream }));
    app.get('/v1/things/:id', (req, res) => {
      (req as any).log.setBindings({ userId: 'u-1', role: 'PARENT' });
      (req as any).log.info({ capability: 'chat' }, 'ai run');
      res.json({ ok: true });
    });
    app.get('/v1/health', (_req, res) => res.json({ ok: true }));
    app.get('/v1/missing', (_req, res) => res.status(404).json({}));
    return { app, lines };
  }

  it('logs one slim completion line and correlates in-request lines by reqId', async () => {
    const { app, lines } = build();
    await request(app)
      .get('/v1/things/abc?token=secret')
      .set('authorization', 'Bearer x')
      .set('x-request-id', 'req-1')
      .set('cf-connecting-ip', '1.2.3.4');

    const [inner, done] = lines;
    expect(inner).toMatchObject({ reqId: 'req-1', userId: 'u-1', msg: 'ai run', env: 'staging' });
    expect(inner.req).toBeUndefined();
    expect(done).toMatchObject({
      reqId: 'req-1',
      userId: 'u-1',
      role: 'PARENT',
      method: 'GET',
      path: '/v1/things/abc',
      statusCode: 200,
      ip: '1.2.3.4',
      level: 30,
    });
    expect(JSON.stringify(done)).not.toMatch(/secret|Bearer/);
    expect(done.req).toBeUndefined();
    expect(done.res).toBeUndefined();
    expect(done.msg).toMatch(/^GET \/v1\/things\/abc 200 \d+ms$/);
  });

  it('keeps health checks at debug and client errors at warn', async () => {
    const { app, lines } = build();
    await request(app).get('/v1/health');
    await request(app).get('/v1/missing');
    expect(lines[0].level).toBe(20);
    expect(lines[1].level).toBe(40);
  });
});
