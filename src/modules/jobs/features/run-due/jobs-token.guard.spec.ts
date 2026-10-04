import type { ExecutionContext } from '@nestjs/common';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JobsTokenGuard } from './jobs-token.guard';

const TOKEN = 'a'.repeat(32);

function guard(token: string): JobsTokenGuard {
  const config = { get: () => ({ runToken: token }) } as unknown as ConfigService<never, true>;
  return new JobsTokenGuard(config as never);
}

function ctx(header?: string | string[]): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-jobs-token': header } }) }),
  } as unknown as ExecutionContext;
}

describe('JobsTokenGuard', () => {
  it('is disabled (404) when no token is configured', () => {
    expect(() => guard('').canActivate(ctx(TOKEN))).toThrow(NotFoundException);
  });

  it('rejects a missing or wrong token with 401', () => {
    expect(() => guard(TOKEN).canActivate(ctx())).toThrow(UnauthorizedException);
    expect(() => guard(TOKEN).canActivate(ctx('b'.repeat(32)))).toThrow(UnauthorizedException);
    expect(() => guard(TOKEN).canActivate(ctx('short'))).toThrow(UnauthorizedException);
  });

  it('accepts the right token', () => {
    expect(guard(TOKEN).canActivate(ctx(TOKEN))).toBe(true);
  });
});
