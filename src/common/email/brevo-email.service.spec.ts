import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@common/config/configuration';
import { BrevoEmailService } from './brevo-email.service';

describe('BrevoEmailService', () => {
  const fetchMock = jest.fn();
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  function build(brevoApiKey = 'xkeysib-secret-value', from = 'NeuroNest <me@gmail.com>') {
    const values: Record<string, unknown> = {
      email: { provider: 'brevo', resendApiKey: '', brevoApiKey, from },
      verification: { emailTtlMin: 10, passwordResetTtlMin: 60, accountSetupTtlHours: 72 },
    };
    const config = { get: (key: string) => values[key] } as unknown as ConfigService<
      AppConfig,
      true
    >;
    return new BrevoEmailService(config);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockResolvedValue({ ok: true, status: 201 });
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('POSTs the verification code to the Brevo API with the parsed sender', async () => {
    await build().sendEmailVerificationCode('parent@gmail.com', '123456');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.method).toBe('POST');
    expect(init.headers['api-key']).toBe('xkeysib-secret-value');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      sender: { name: 'NeuroNest', email: 'me@gmail.com' },
      to: [{ email: 'parent@gmail.com' }],
      subject: expect.stringContaining('verification code'),
      textContent: expect.stringContaining('123456'),
    });
    expect(body.htmlContent).toEqual(expect.any(String));
  });

  it('sends reset and setup links', async () => {
    const service = build();
    await service.sendPasswordResetLink('p@gmail.com', 'https://app/reset?t=abc');
    await service.sendAccountSetupLink('c@gmail.com', 'https://app/setup?t=xyz');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).textContent).toContain(
      'https://app/reset?t=abc',
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).textContent).toContain(
      'https://app/setup?t=xyz',
    );
  });

  it('logs instead of sending when BREVO_API_KEY is unset', async () => {
    await build('').sendEmailVerificationCode('parent@gmail.com', '123456');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('BREVO_API_KEY'));
  });

  it('logs the reason (masked recipient, no key) and throws on an API error so the job retries', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: () => Promise.resolve({ code: 'invalid_parameter', message: 'sender is not valid' }),
    });
    await expect(build().sendEmailVerificationCode('parent@gmail.com', '123456')).rejects.toThrow(
      'Failed to send email: sender is not valid',
    );
    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      to: 'p***@gmail.com',
      statusCode: 400,
      name: 'invalid_parameter',
      reason: 'sender is not valid',
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('xkeysib-secret-value');
  });

  it('throws on a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'));
    await expect(build().sendEmailVerificationCode('parent@gmail.com', '123456')).rejects.toThrow(
      'Failed to send email: fetch failed',
    );
    expect(errorSpy).toHaveBeenCalled();
  });
});
