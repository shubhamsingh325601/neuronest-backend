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
    EMAIL_PROVIDER: 'resend',
    CORS_ORIGINS: 'https://app.example.com',
    CLOUDINARY_CLOUD_NAME: 'c',
    CLOUDINARY_API_KEY: 'k',
    CLOUDINARY_API_SECRET: 's',
    RESEND_API_KEY: 're_key',
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
      expect(
        validate({ ...base, NODE_ENV: 'development', RESEND_API_KEY: '' }).error,
      ).toBeUndefined();
      expect(validate({ ...base, NODE_ENV: 'test' }).error).toBeUndefined();
    });
  });

  describe('AI (plan 0018)', () => {
    it('defaults to disabled with the planned limits', () => {
      const { value, error } = envValidationSchema.validate(base);
      expect(error).toBeUndefined();
      expect(value).toMatchObject({
        AI_ENABLED: false,
        AI_MODEL: 'google:gemini-3.5-flash-lite',
        AI_FALLBACK_MODEL: '',
        AI_ALLOW_REAL_DATA: false,
        AI_TIMEOUT_MS: 10000,
        AI_MAX_OUTPUT_TOKENS: 700,
        AI_USER_DAILY_LIMIT: 3,
        AI_DAILY_REQUEST_BUDGET: 400,
        AI_OUTPUT_RETENTION_DAYS: 14,
      });
    });

    it('accepts production with AI disabled and no keys', () => {
      expect(validate(production).error).toBeUndefined();
    });

    it('rejects a malformed or unknown-provider model', () => {
      expect(validate({ ...base, AI_MODEL: 'gemini-3.5-flash-lite' }).error?.message).toContain(
        'AI_MODEL',
      );
      expect(validate({ ...base, AI_MODEL: 'mistral:large' }).error?.message).toContain('AI_MODEL');
      expect(validate({ ...base, AI_FALLBACK_MODEL: 'nope' }).error?.message).toContain(
        'AI_FALLBACK_MODEL',
      );
    });

    describe('provider keys when AI_ENABLED=true', () => {
      const enabled = { ...base, AI_ENABLED: 'true' };

      it('requires the key for the primary model provider', () => {
        expect(validate(enabled).error?.message).toContain('GOOGLE_GENERATIVE_AI_API_KEY');
      });

      it('requires the key for the fallback provider too', () => {
        const env = {
          ...enabled,
          GOOGLE_GENERATIVE_AI_API_KEY: 'k',
          AI_FALLBACK_MODEL: 'anthropic:claude-x',
        };
        expect(validate(env).error?.message).toContain('ANTHROPIC_API_KEY');
      });

      it('accepts a complete dev configuration', () => {
        const env = {
          ...enabled,
          GOOGLE_GENERATIVE_AI_API_KEY: 'k',
          AI_FALLBACK_MODEL: 'google:gemini-3.1-flash-lite',
        };
        expect(validate(env).error).toBeUndefined();
      });

      it('does not demand a key while disabled', () => {
        expect(validate({ ...base, AI_ENABLED: 'false' }).error).toBeUndefined();
      });
    });

    describe('gate G1: real-data attestation in production', () => {
      const prodEnabled = { ...production, AI_ENABLED: 'true', GOOGLE_GENERATIVE_AI_API_KEY: 'k' };

      it('fails boot in production when enabled without AI_ALLOW_REAL_DATA=true', () => {
        expect(validate(prodEnabled).error?.message).toContain('AI_ALLOW_REAL_DATA');
        expect(validate({ ...prodEnabled, AI_ALLOW_REAL_DATA: 'false' }).error?.message).toContain(
          'AI_ALLOW_REAL_DATA',
        );
      });

      it('passes in production with the attestation', () => {
        expect(validate({ ...prodEnabled, AI_ALLOW_REAL_DATA: 'true' }).error).toBeUndefined();
      });

      it('does not apply outside production (free tier is fine for synthetic dev/test)', () => {
        const env = {
          ...base,
          NODE_ENV: 'development',
          AI_ENABLED: 'true',
          GOOGLE_GENERATIVE_AI_API_KEY: 'k',
        };
        expect(validate(env).error).toBeUndefined();
      });
    });
  });
});
