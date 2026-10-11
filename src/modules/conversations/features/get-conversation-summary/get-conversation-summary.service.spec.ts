import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConversationKind, Role, SummaryStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import type { PrismaService } from '@common/prisma/prisma.service';
import { GetConversationSummaryService } from './get-conversation-summary.service';

const content = {
  overview: 'o',
  themes: ['sleep'],
  parentConcerns: [],
  guidanceGiven: [],
  openQuestions: [],
  followUpSuggested: false,
  participantsKind: 'HUMAN',
};

describe('GetConversationSummaryService', () => {
  const prisma = {
    conversation: { findUnique: jest.fn() },
    expertChildAssignment: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
    child: { findUnique: jest.fn() },
  };
  const service = new GetConversationSummaryService(prisma as unknown as PrismaService);
  const user = (role: Role, id = 'u-1'): AuthenticatedUser =>
    ({ id, role, email: 'x@example.com' }) as AuthenticatedUser;

  const row = (patch: Record<string, unknown> = {}) => ({
    childId: 'child-1',
    parentId: 'parent-1',
    expertId: 'expert-1',
    kind: ConversationKind.HUMAN,
    closedAt: new Date('2026-11-01T00:00:00Z'),
    messagesPurgedAt: null,
    summary: {
      id: 's-1',
      conversationId: 'c-1',
      childId: 'child-1',
      status: SummaryStatus.READY,
      content,
      generatedAt: new Date('2026-11-01T01:00:00Z'),
      createdAt: new Date('2026-11-01T00:00:00Z'),
    },
    ...patch,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.conversation.findUnique.mockResolvedValue(row());
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    prisma.expertChildAssignment.findUnique.mockResolvedValue({ id: 'a' });
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue({ id: 'a' });
  });

  it('returns the summary to the conversation parent', async () => {
    const dto = await service.get('c-1', user(Role.PARENT, 'parent-1'));
    expect(dto).toMatchObject({ status: 'READY', kind: 'HUMAN', content, note: null });
  });

  it('refuses another parent', async () => {
    await expect(service.get('c-1', user(Role.PARENT, 'other'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns it to the conversation expert while assigned, and refuses an unassigned one', async () => {
    await expect(service.get('c-1', user(Role.EXPERT, 'expert-1'))).resolves.toBeDefined();
    prisma.expertChildAssignment.findUnique.mockResolvedValue(null);
    await expect(service.get('c-1', user(Role.EXPERT, 'expert-1'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses an expert who is not the conversation expert, even when assigned to the child', async () => {
    await expect(service.get('c-1', user(Role.EXPERT, 'expert-2'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses an expert on an AI conversation (it has no expert)', async () => {
    prisma.conversation.findUnique.mockResolvedValue(row({ kind: 'AI', expertId: null }));
    await expect(service.get('c-1', user(Role.EXPERT, 'expert-1'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns it to a clinician assigned to the child, and refuses an unassigned one', async () => {
    await expect(service.get('c-1', user(Role.CLINICIAN))).resolves.toBeDefined();
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(service.get('c-1', user(Role.CLINICIAN))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns it to an admin', async () => {
    await expect(service.get('c-1', user(Role.ADMIN))).resolves.toBeDefined();
  });

  it('refuses a role it does not know (default-deny)', async () => {
    await expect(service.get('c-1', user('SOMETHING_NEW' as Role))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('is 404 for an unknown conversation, and for one with no summary yet', async () => {
    prisma.conversation.findUnique.mockResolvedValue(null);
    await expect(service.get('c-1', user(Role.ADMIN))).rejects.toMatchObject({
      response: { code: 'CONVERSATION_NOT_FOUND' },
    });
    prisma.conversation.findUnique.mockResolvedValue(row({ summary: null }));
    const err = await service.get('c-1', user(Role.ADMIN)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err).toMatchObject({ response: { code: 'SUMMARY_NOT_FOUND' } });
  });

  it('hides the content and gives a note for a PLACEHOLDER summary', async () => {
    prisma.conversation.findUnique.mockResolvedValue(
      row({
        messagesPurgedAt: new Date('2026-12-01T10:00:00Z'),
        summary: { ...row().summary, status: SummaryStatus.PLACEHOLDER, content: null },
      }),
    );
    const dto = await service.get('c-1', user(Role.ADMIN));
    expect(dto.content).toBeNull();
    expect(dto.note).toBe('Summary unavailable; the conversation was removed on 2026-12-01.');
  });

  it('hides the content while the summary is not READY', async () => {
    prisma.conversation.findUnique.mockResolvedValue(
      row({ summary: { ...row().summary, status: SummaryStatus.FAILED, content: null } }),
    );
    expect((await service.get('c-1', user(Role.ADMIN))).content).toBeNull();
  });
});
