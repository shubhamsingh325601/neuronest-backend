import type { ExecutionContext } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { ConversationEventsGuard } from './conversation-events.guard';

const context = (id: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        params: { id },
        user: { id: 'u-1', email: 'u@example.com', role: Role.PARENT, status: UserStatus.ACTIVE },
      }),
    }),
  }) as unknown as ExecutionContext;

describe('ConversationEventsGuard', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';

  it('lets the request through when the service allows it', async () => {
    const service = { assertCanOpen: jest.fn().mockResolvedValue(undefined) };
    const guard = new ConversationEventsGuard(service as never);

    await expect(guard.canActivate(context(uuid))).resolves.toBe(true);
    expect(service.assertCanOpen).toHaveBeenCalledWith(uuid, expect.objectContaining({ id: 'u-1' }));
  });

  it('refuses a malformed id with 400 before touching the service', async () => {
    const service = { assertCanOpen: jest.fn() };
    const guard = new ConversationEventsGuard(service as never);

    await expect(guard.canActivate(context('not-a-uuid'))).rejects.toMatchObject({ status: 400 });
    expect(service.assertCanOpen).not.toHaveBeenCalled();
  });

  it('passes the service refusal on unchanged', async () => {
    const refusal = Object.assign(new Error('no'), { status: 429 });
    const service = { assertCanOpen: jest.fn().mockRejectedValue(refusal) };
    const guard = new ConversationEventsGuard(service as never);

    await expect(guard.canActivate(context(uuid))).rejects.toBe(refusal);
  });
});
