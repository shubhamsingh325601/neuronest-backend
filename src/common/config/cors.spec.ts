import { Controller, Get, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { envValidationSchema } from './env.validation';
import { buildCorsOptions, parseCorsOrigins } from './cors';

describe('parseCorsOrigins', () => {
  it('returns [] for undefined / blank input', () => {
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(parseCorsOrigins('')).toEqual([]);
    expect(parseCorsOrigins(' , ,')).toEqual([]);
  });

  it('splits on commas, trims whitespace and de-duplicates', () => {
    expect(
      parseCorsOrigins(' http://localhost:3000 ,http://localhost:3001,http://localhost:3000 '),
    ).toEqual(['http://localhost:3000', 'http://localhost:3001']);
  });

  it('accepts https origins with and without a port', () => {
    expect(parseCorsOrigins('https://app.example.com,https://app.example.com:8443')).toEqual([
      'https://app.example.com',
      'https://app.example.com:8443',
    ]);
  });

  it.each([
    ['*', /not a valid http\(s\) origin/],
    ['localhost:3000', /not a valid http\(s\) origin/],
    ['ftp://example.com', /not a valid http\(s\) origin/],
    ['https://app.example.com/', /use "https:\/\/app\.example\.com"/],
    ['https://app.example.com/path', /use "https:\/\/app\.example\.com"/],
    ['HTTPS://App.Example.com', /use "https:\/\/app\.example\.com"/],
    ['https://app.example.com:443', /use "https:\/\/app\.example\.com"/],
  ])('rejects %s', (entry, message) => {
    expect(() => parseCorsOrigins(`http://localhost:3000,${entry}`)).toThrow(message);
  });
});

describe('envValidationSchema CORS_ORIGINS', () => {
  const base = {
    APP_WEB_URL: 'http://localhost:5173',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_ACCESS_SECRET: 'a-long-enough-secret-value',
    EMAIL_FROM: 'NeuroNest <no-reply@neuronest.example>',
  };

  it('defaults to empty outside production', () => {
    const { error, value } = envValidationSchema.validate({ ...base, NODE_ENV: 'development' });
    expect(error).toBeUndefined();
    expect(value.CORS_ORIGINS).toBe('');
  });

  it('accepts a valid list', () => {
    const { error } = envValidationSchema.validate({
      ...base,
      CORS_ORIGINS: 'http://localhost:3000,http://localhost:3001',
    });
    expect(error).toBeUndefined();
  });

  it('rejects a malformed entry with the canonical-form hint', () => {
    const { error } = envValidationSchema.validate({
      ...base,
      CORS_ORIGINS: 'http://localhost:3000/',
    });
    expect(error?.message).toMatch(/use "http:\/\/localhost:3000"/);
  });

  it('is required (non-empty) in production', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      EMAIL_PROVIDER: 'resend',
      CLOUDINARY_CLOUD_NAME: 'c',
      CLOUDINARY_API_KEY: 'k',
      CLOUDINARY_API_SECRET: 's',
      RESEND_API_KEY: 're_key',
    };
    expect(envValidationSchema.validate(prod).error).toBeDefined();
    expect(envValidationSchema.validate({ ...prod, CORS_ORIGINS: '' }).error).toBeDefined();
    expect(
      envValidationSchema.validate({ ...prod, CORS_ORIGINS: 'https://app.example.com' }).error,
    ).toBeUndefined();
  });
});

@Controller()
class PingController {
  @Get('ping')
  ping(): { ok: true } {
    return { ok: true };
  }

  @Post('ping')
  create(): { ok: true } {
    return { ok: true };
  }
}

describe('enableCors(buildCorsOptions(...)) behaviour', () => {
  let app: INestApplication;

  async function boot(origins: string[]): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ controllers: [PingController] }).compile();
    const instance = moduleRef.createNestApplication();
    instance.enableCors(buildCorsOptions(origins));
    await instance.init();
    return instance;
  }

  afterEach(async () => {
    await app.close();
  });

  it('echoes an allow-listed origin (never "*") and exposes the useful headers', async () => {
    app = await boot(['http://localhost:3000', 'http://localhost:3001']);

    const res = await request(app.getHttpServer())
      .get('/ping')
      .set('Origin', 'http://localhost:3001')
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.headers['vary']).toMatch(/Origin/i);
    expect(res.headers['access-control-expose-headers']).toContain('X-Request-Id');
    expect(res.headers['access-control-expose-headers']).toContain('Retry-After');
  });

  it('answers a preflight for an allow-listed origin and reflects requested headers', async () => {
    app = await boot(['http://localhost:3000']);

    const res = await request(app.getHttpServer())
      .options('/ping')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type')
      .expect(204);

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toBe('authorization,content-type');
    expect(res.headers['access-control-max-age']).toBe('600');
  });

  it('sends no CORS headers to an origin that is not on the list', async () => {
    app = await boot(['http://localhost:3000']);

    const res = await request(app.getHttpServer())
      .get('/ping')
      .set('Origin', 'https://evil.example')
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();

    const preflight = await request(app.getHttpServer())
      .options('/ping')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not block requests that carry no Origin header (curl, mobile, server-to-server)', async () => {
    app = await boot(['http://localhost:3000']);

    const res = await request(app.getHttpServer()).get('/ping').expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('allows no cross-origin browser access when the list is empty', async () => {
    app = await boot([]);

    const res = await request(app.getHttpServer())
      .get('/ping')
      .set('Origin', 'http://localhost:3000')
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
