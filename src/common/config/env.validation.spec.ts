import { envValidationSchema } from './env.validation';

describe('envValidationSchema', () => {
  const base = {
    APP_WEB_URL: 'http://localhost:3001',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_ACCESS_SECRET: 'a-sixteen-char-secret',
    EMAIL_FROM: 'NeuroNest <no-reply@example.com>',
  };
  const production = {
    ...base,
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://app.example.com',
    CLOUDINARY_CLOUD_NAME: 'c',
    CLOUDINARY_API_KEY: 'k',
    CLOUDINARY_API_SECRET: 's',
    RESEND_API_KEY: 're_key',
    TRUST_PROXY_HOPS: '1',
  };
  const validate = (env: Record<string, string>) => envValidationSchema.validate(env);

  it('accepts a complete production environment', () => {
    expect(validate(production).error).toBeUndefined();
  });

  describe('RESEND_API_KEY (B-5)', () => {
    it('is required in production', () => {
      const env: Record<string, string> = { ...production };
      delete env.RESEND_API_KEY;
      expect(validate(env).error?.message).toContain('RESEND_API_KEY');
    });

    it('rejects an empty value in production', () => {
      expect(validate({ ...production, RESEND_API_KEY: '' }).error?.message).toContain(
        'RESEND_API_KEY',
      );
    });

    it('may be empty in development and test', () => {
      expect(validate({ ...base, NODE_ENV: 'development', RESEND_API_KEY: '' }).error).toBeUndefined();
      expect(validate({ ...base, NODE_ENV: 'test' }).error).toBeUndefined();
    });
  });

  describe('TRUST_PROXY_HOPS (B-2)', () => {
    it('defaults to 0 outside production', () => {
      expect(validate(base).value.TRUST_PROXY_HOPS).toBe(0);
    });

    it('is required in production', () => {
      const env: Record<string, string> = { ...production };
      delete env.TRUST_PROXY_HOPS;
      expect(validate(env).error?.message).toContain('TRUST_PROXY_HOPS');
    });

    it('accepts 0 in production (explicitly measured as no proxy)', () => {
      expect(validate({ ...production, TRUST_PROXY_HOPS: '0' }).error).toBeUndefined();
    });

    it.each(['-1', '1.5', 'true', 'abc'])('rejects %s', (value) => {
      expect(validate({ ...base, TRUST_PROXY_HOPS: value }).error?.message).toContain(
        'TRUST_PROXY_HOPS',
      );
    });
  });
});
