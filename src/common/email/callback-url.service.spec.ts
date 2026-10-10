import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CallbackUrlService } from './callback-url.service';

describe('CallbackUrlService', () => {
  const service = new CallbackUrlService({
    get: (key: string) =>
      key === 'appWebUrl'
        ? 'https://app.example/'
        : { origins: ['https://admin.example', 'http://localhost:5173'] },
  } as unknown as ConfigService<never, true>);

  it('passes undefined through (callbackUrl is optional)', () => {
    expect(service.assertAllowed(undefined)).toBeUndefined();
  });

  it.each([
    'https://app.example/reset-password',
    'https://admin.example/set-password?lang=en',
    'http://localhost:5173/complete-account-setup',
  ])('accepts %s', (url) => {
    expect(service.assertAllowed(url)).toBe(url);
  });

  it.each([
    'https://evil.example/reset-password',
    'https://app.example.evil.example/x',
    'https://app.example@evil.example/x',
    'https://app.example/x#frag',
    'javascript:alert(1)',
    'neuronest://reset',
    'reset-password',
  ])('rejects %s with 400 INVALID_CALLBACK_URL', (url) => {
    const run = () => service.assertAllowed(url);
    expect(run).toThrow(BadRequestException);
    expect(run).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'INVALID_CALLBACK_URL' }) }));
  });
});
