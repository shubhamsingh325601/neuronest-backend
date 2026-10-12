import { ForbiddenException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { AI_CHAT_TOPICS_VERSION } from '@modules/conversations/shared/ai-chat.constants';
import { ListAiChatTopicsService } from './list-ai-chat-topics.service';

const user = (role: Role): AuthenticatedUser => ({
  id: 'u1',
  email: 'u@example.com',
  role,
  status: UserStatus.ACTIVE,
});

describe('ListAiChatTopicsService', () => {
  const service = new ListAiChatTopicsService();

  it('returns the versioned list, with the four AI topics, two routes and the unavailable assessment', () => {
    const res = service.list(user(Role.PARENT));

    expect(res.version).toBe(AI_CHAT_TOPICS_VERSION);
    expect(res.data.map((t) => `${t.kind}:${t.id}`)).toEqual([
      'AI:TODAYS_ACTIVITIES',
      'AI:PLAN_EXPLAINER',
      'AI:RECENT_PROGRESS',
      'AI:EVERYDAY_ROUTINES',
      'ROUTE:BOOK_CALL',
      'ROUTE:TALK_TO_EXPERT',
      'UNAVAILABLE:AI_ASSESSMENT',
    ]);
    expect(Object.keys(res.data[0]).sort()).toEqual(['description', 'id', 'kind', 'label']);
  });

  it.each([Role.ADMIN, Role.EXPERT, Role.CLINICIAN])('%s is refused', (role) => {
    expect(() => service.list(user(role))).toThrow(ForbiddenException);
  });
});
