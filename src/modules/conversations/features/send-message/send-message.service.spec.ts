import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConversationKind, MessageSender, Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { SendMessageService } from './send-message.service';

describe('SendMessageService', () => {
  const tx = {
    $queryRaw: jest.fn(),
    message: { findUnique: jest.fn(), create: jest.fn() },
    conversation: { update: jest.fn() },
  };
  const prisma = {
    conversation: { findUnique: jest.fn() },
    expertChildAssignment: { findUnique: jest.fn() },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  let service: SendMessageService;
  const parent: AuthenticatedUser = {
    id: 'pa-1',
    email: 'pa-1@example.com',
    role: Role.PARENT,
    status: UserStatus.ACTIVE,
  };
  const expert: AuthenticatedUser = { ...parent, id: 'ex-1', role: Role.EXPERT };
  const dto = { text: 'hello there', clientMessageId: 'client-1' };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'c-1',
      kind: ConversationKind.HUMAN,
      childId: 'child-1',
      parentId: 'pa-1',
      expertId: 'ex-1',
    });
    prisma.expertChildAssignment.findUnique.mockResolvedValue({ id: 'a-1' });
    tx.$queryRaw.mockResolvedValue([{ status: 'OPEN', lastMessageSeq: 4 }]);
    tx.message.findUnique.mockResolvedValue(null);
    tx.message.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'm-1', state: 'COMPLETE', ...data }),
    );
    const moduleRef = await Test.createTestingModule({
      providers: [SendMessageService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(SendMessageService);
  });

  it('takes the next seq under the row lock and records the parent as sender', async () => {
    const message = await service.send('c-1', dto, parent);

    expect(message).toMatchObject({ seq: 5, sender: MessageSender.PARENT, body: 'hello there' });
    expect(tx.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c-1' },
      data: { lastMessageSeq: 5, lastMessageAt: expect.any(Date) },
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.conversation.update.mock.invocationCallOrder[0],
    );
  });

  it('records the expert as sender for an expert', async () => {
    await expect(service.send('c-1', dto, expert)).resolves.toMatchObject({
      sender: MessageSender.EXPERT,
    });
    expect(tx.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sender: MessageSender.EXPERT, senderId: 'ex-1' }),
    });
  });

  it('returns the stored message for a repeated clientMessageId and writes nothing', async () => {
    tx.message.findUnique.mockResolvedValue({
      id: 'm-0',
      seq: 2,
      senderId: 'pa-1',
      body: 'hello there',
    });

    await expect(service.send('c-1', dto, parent)).resolves.toMatchObject({ id: 'm-0', seq: 2 });
    expect(tx.message.create).not.toHaveBeenCalled();
    expect(tx.conversation.update).not.toHaveBeenCalled();
  });

  it('still returns the stored message when the conversation has since closed', async () => {
    tx.$queryRaw.mockResolvedValue([{ status: 'CLOSED', lastMessageSeq: 4 }]);
    tx.message.findUnique.mockResolvedValue({ id: 'm-0', seq: 2, senderId: 'pa-1' });
    await expect(service.send('c-1', dto, parent)).resolves.toMatchObject({ id: 'm-0' });
  });

  it('409s when the clientMessageId belongs to the other participant', async () => {
    tx.message.findUnique.mockResolvedValue({ id: 'm-0', seq: 2, senderId: 'ex-1' });
    await expect(service.send('c-1', dto, parent)).rejects.toMatchObject({
      response: { code: 'CLIENT_MESSAGE_ID_IN_USE' },
    });
  });

  it('409s CONVERSATION_CLOSED for a new message on a closed conversation', async () => {
    tx.$queryRaw.mockResolvedValue([{ status: 'CLOSED', lastMessageSeq: 4 }]);
    const err = await service.send('c-1', dto, parent).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'CONVERSATION_CLOSED' });
    expect(tx.message.create).not.toHaveBeenCalled();
  });

  it('422s for an AI conversation', async () => {
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'c-1',
      kind: ConversationKind.AI,
      childId: 'child-1',
      parentId: 'pa-1',
      expertId: null,
    });
    await expect(service.send('c-1', dto, parent)).rejects.toThrow(UnprocessableEntityException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
