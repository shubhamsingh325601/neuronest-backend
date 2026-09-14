import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AllExceptionsFilter } from './all-exceptions.filter';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let reply: jest.Mock;
  let setHeader: jest.Mock;

  const request = { id: 'req-123', url: '/v1/auth/login', headers: {} };
  const response = { __marker: 'res' };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    reply = jest.fn();
    setHeader = jest.fn();
    const httpAdapterHost = {
      httpAdapter: {
        getRequestUrl: (req: { url: string }) => req.url,
        setHeader,
        reply,
      },
    } as unknown as HttpAdapterHost;
    filter = new AllExceptionsFilter(httpAdapterHost);
  });

  afterEach(() => jest.restoreAllMocks());

  const caught = (exception: unknown) => {
    filter.catch(exception, host);
    return {
      body: reply.mock.calls[0][1] as Record<string, unknown>,
      status: reply.mock.calls[0][2] as number,
    };
  };

  it('repackages a coded HttpException into the RFC 9457 shape', () => {
    const { body, status } = caught(
      new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect.',
      }),
    );

    expect(status).toBe(401);
    expect(body).toMatchObject({
      type: 'https://docs.neuronest.dev/problems/invalid-credentials',
      title: 'Invalid Credentials',
      status: 401,
      detail: 'Email or password is incorrect.',
      instance: '/v1/auth/login',
      code: 'INVALID_CREDENTIALS',
      requestId: 'req-123',
    });
    expect(body.timestamp).toEqual(expect.any(String));
    expect(body).not.toHaveProperty('errors');
  });

  it('serves application/problem+json', () => {
    caught(new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'nope' }));
    expect(setHeader).toHaveBeenCalledWith(
      response,
      'Content-Type',
      'application/problem+json',
    );
  });

  it('keeps a class-validator message array as `errors` and joins `detail`', () => {
    const { body } = caught(
      new BadRequestException({
        message: ['email must be an email', 'name should not be empty'],
      }),
    );

    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.title).toBe('Validation Error');
    expect(body.detail).toBe('email must be an email; name should not be empty');
    expect(body.errors).toEqual([
      'email must be an email',
      'name should not be empty',
    ]);
  });

  it('defaults the code from the status when the thrower supplies none', () => {
    const { body } = caught(new HttpException('nope', HttpStatus.FORBIDDEN));
    expect(body).toMatchObject({
      code: 'FORBIDDEN',
      title: 'Forbidden',
      detail: 'nope',
      type: 'https://docs.neuronest.dev/problems/forbidden',
    });
  });

  it('falls back to INTERNAL_ERROR for a non-HttpException', () => {
    const { body, status } = caught(new Error('boom'));
    expect(status).toBe(500);
    expect(body).toMatchObject({
      type: 'https://docs.neuronest.dev/problems/internal-error',
      title: 'Internal Error',
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'An unexpected error occurred.',
    });
  });

  it('nulls requestId when neither req.id nor the header is present', () => {
    filter.catch(new UnauthorizedException({ code: 'MISSING_TOKEN', message: 'x' }), {
      switchToHttp: () => ({
        getRequest: () => ({ url: '/v1/users/me', headers: {} }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost);
    expect(reply.mock.calls[0][1].requestId).toBeNull();
  });
});
