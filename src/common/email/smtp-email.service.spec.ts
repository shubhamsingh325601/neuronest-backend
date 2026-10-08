import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import type { AppConfig } from '@common/config/configuration';
import { SmtpEmailService } from './smtp-email.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

describe('SmtpEmailService', () => {
  const sendMail = jest.fn();
  const createTransportMock = createTransport as unknown as jest.Mock;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  function build(
    smtp: Partial<AppConfig['email']['smtp']> = {},
    from = 'NeuroNest <me@gmail.com>',
  ) {
    const email = {
      provider: 'smtp',
      resendApiKey: '',
      from,
      smtp: {
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        user: 'me@gmail.com',
        password: 'app-password-value',
        ...smtp,
      },
    };
    const values: Record<string, unknown> = {
      email,
      verification: { emailTtlMin: 10, passwordResetTtlMin: 60, accountSetupTtlHours: 72 },
    };
    const config = { get: (key: string) => values[key] } as unknown as ConfigService<
      AppConfig,
      true
    >;
    return new SmtpEmailService(config);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    createTransportMock.mockReturnValue({ sendMail });
    sendMail.mockResolvedValue({ messageId: 'm1' });
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('configures the transport from SMTP settings with bounded timeouts', () => {
    build();
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: 'me@gmail.com', pass: 'app-password-value' },
        connectionTimeout: 10_000,
      }),
    );
  });

  it('sends the verification code from EMAIL_FROM', async () => {
    await build().sendEmailVerificationCode('parent@gmail.com', '123456');
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'NeuroNest <me@gmail.com>',
        to: 'parent@gmail.com',
        subject: expect.stringContaining('verification code'),
        text: expect.stringContaining('123456'),
      }),
    );
  });

  it('sends reset and setup links', async () => {
    const service = build();
    await service.sendPasswordResetLink('p@gmail.com', 'https://app/reset?t=abc');
    await service.sendAccountSetupLink('c@gmail.com', 'https://app/setup?t=xyz');
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail.mock.calls[0][0].text).toContain('https://app/reset?t=abc');
    expect(sendMail.mock.calls[1][0].text).toContain('https://app/setup?t=xyz');
  });

  it('logs instead of sending when credentials are unset', async () => {
    const service = build({ user: '', password: '' });
    await service.sendEmailVerificationCode('parent@gmail.com', '123456');
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SMTP_USER/SMTP_PASSWORD'));
  });

  it('warns when EMAIL_FROM is not the authenticated mailbox', () => {
    build({}, 'NeuroNest <someone-else@gmail.com>');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('differs from SMTP_USER'));
  });

  it('does not warn when EMAIL_FROM matches SMTP_USER case-insensitively', () => {
    build({ user: 'Me@Gmail.com' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs the reason (masked recipient, no secrets) and rethrows so the job retries', async () => {
    sendMail.mockRejectedValue(
      Object.assign(new Error('Invalid login: 535 Username and Password not accepted'), {
        code: 'EAUTH',
        responseCode: 535,
      }),
    );
    await expect(build().sendEmailVerificationCode('parent@gmail.com', '123456')).rejects.toThrow(
      'Failed to send email: Invalid login',
    );
    const [fields] = errorSpy.mock.calls[0];
    expect(fields).toMatchObject({
      to: 'p***@gmail.com',
      code: 'EAUTH',
      responseCode: 535,
      reason: expect.stringContaining('Invalid login'),
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('app-password-value');
    expect(fields.hint).toBeUndefined();
  });

  it('hints at blocked outbound SMTP on network-level failures', async () => {
    sendMail.mockRejectedValue(
      Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' }),
    );
    await expect(build().sendEmailVerificationCode('parent@gmail.com', '123456')).rejects.toThrow();
    expect(errorSpy.mock.calls[0][0].hint).toContain('Render free tier');
  });
});
