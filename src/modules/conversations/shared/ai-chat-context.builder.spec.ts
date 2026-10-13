import { NotFoundException } from '@nestjs/common';
import { AiChatTopic, Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import type { ChildDto } from '@modules/children/shared/child.dto';
import {
  AiChatContextBuilder,
  assembleChatContext,
  type RawChatInput,
} from './ai-chat-context.builder';

const raw: RawChatInput = {
  childName: 'Zephyrine Rao',
  ageYears: 6,
  planDay: {
    dayNumber: 3,
    title: 'Zephyrine bedtime',
    instructions: 'Ask Zephyrine to pick a story.',
  },
  planSections: ['Week 1: Zephyrine settles', 'Week 2'],
  planDays: [
    { dayNumber: 1, title: 'Wind down' },
    { dayNumber: 2, title: 'Story time' },
  ],
  daysLogged: 4,
  sleepMinutesAverage: 479.6,
  themes: ['sleep', 'routines'],
};

describe('assembleChatContext (the allow-list per topic)', () => {
  it('TODAYS_ACTIVITIES: age and today only', () => {
    const { context } = assembleChatContext(AiChatTopic.TODAYS_ACTIVITIES, raw);

    expect(context).toEqual({
      ageYears: 6,
      planDay: {
        dayNumber: 3,
        title: 'the child bedtime',
        instructions: 'Ask the child to pick a story.',
      },
    });
  });

  it('PLAN_EXPLAINER: section and day titles, not the day instructions', () => {
    const { context } = assembleChatContext(AiChatTopic.PLAN_EXPLAINER, raw);

    expect(context).toEqual({
      ageYears: 6,
      planOverview: {
        sections: ['Week 1: the child settles', 'Week 2'],
        days: [
          { dayNumber: 1, title: 'Wind down' },
          { dayNumber: 2, title: 'Story time' },
        ],
      },
    });
  });

  it('RECENT_PROGRESS: last week and themes only', () => {
    const { context } = assembleChatContext(AiChatTopic.RECENT_PROGRESS, raw);

    expect(context).toEqual({
      ageYears: 6,
      lastWeek: { daysLogged: 4, sleepMinutesAverage: 480 },
      recentThemes: ['sleep', 'routines'],
    });
  });

  it('EVERYDAY_ROUTINES: today and the plan overview', () => {
    const { context } = assembleChatContext(AiChatTopic.EVERYDAY_ROUTINES, raw);

    expect(Object.keys(context).sort()).toEqual(['ageYears', 'planDay', 'planOverview']);
  });

  it('never carries the child name, and returns its parts for the output check', () => {
    for (const topic of Object.values(AiChatTopic)) {
      const built = assembleChatContext(topic, raw);
      expect(JSON.stringify(built.context)).not.toMatch(/Zephyrine|Rao/);
      expect(built.nameTokens).toEqual(['Zephyrine', 'Rao']);
    }
  });

  it('caps the number and length of titles', () => {
    const { context } = assembleChatContext(AiChatTopic.PLAN_EXPLAINER, {
      ...raw,
      planSections: Array.from({ length: 20 }, (_, i) => `S${i}`),
      planDays: Array.from({ length: 50 }, (_, i) => ({
        dayNumber: i + 1,
        title: 'x'.repeat(500),
      })),
    });

    expect(context.planOverview?.sections).toHaveLength(10);
    expect(context.planOverview?.days).toHaveLength(30);
    expect(context.planOverview?.days[0].title).toHaveLength(200);
  });
});

describe('AiChatContextBuilder', () => {
  const caller: AuthenticatedUser = {
    id: 'p1',
    email: 'p@example.com',
    role: Role.PARENT,
    status: UserStatus.ACTIVE,
  };
  const child = {
    id: 'c1',
    name: 'Zephyrine Rao',
    dateOfBirth: new Date('2019-05-14'),
  } as unknown as ChildDto;
  const now = new Date('2026-10-11T00:00:00Z');

  function make() {
    const summaryThemes = {
      read: jest.fn().mockResolvedValue({ themes: [], followUpSuggested: false }),
    };
    const todayFocus = {
      get: jest.fn().mockResolvedValue({
        plan: { id: 'plan-1' },
        day: { dayNumber: 3, title: 'Bedtime', instructions: 'Dim the lights.' },
      }),
    };
    const plans = {
      getById: jest.fn().mockResolvedValue({
        sections: [{ title: 'Week 1' }],
        days: [{ dayNumber: 1, title: 'Wind down' }],
      }),
    };
    const weekly = {
      summarise: jest.fn().mockResolvedValue({ daysLogged: 5, sleepMinutes: { average: 500 } }),
    };
    const builder = new AiChatContextBuilder(
      summaryThemes as never,
      todayFocus as never,
      plans as never,
      weekly as never,
    );
    return { builder, summaryThemes, todayFocus, plans, weekly };
  }

  it('calls the domain services with the real caller, and only the ones the topic needs', async () => {
    const { builder, todayFocus, plans, weekly } = make();

    const built = await builder.build(AiChatTopic.TODAYS_ACTIVITIES, child, caller, now);

    expect(todayFocus.get).toHaveBeenCalledWith('c1', caller);
    expect(plans.getById).not.toHaveBeenCalled();
    expect(weekly.summarise).not.toHaveBeenCalled();
    expect(built.context.planDay).toMatchObject({ dayNumber: 3, title: 'Bedtime' });
    expect(built.context.ageYears).toBe(7);
  });

  it('loads the plan overview for PLAN_EXPLAINER', async () => {
    const { builder, plans } = make();

    const built = await builder.build(AiChatTopic.PLAN_EXPLAINER, child, caller, now);

    expect(plans.getById).toHaveBeenCalledWith('plan-1', caller);
    expect(built.context.planOverview).toEqual({
      sections: ['Week 1'],
      days: [{ dayNumber: 1, title: 'Wind down' }],
    });
  });

  it('RECENT_PROGRESS: last week plus the themes of ready summaries, themes only', async () => {
    const { builder, summaryThemes, weekly, todayFocus } = make();
    summaryThemes.read.mockResolvedValue({
      themes: ['sleep', 'routines'],
      followUpSuggested: true,
    });

    const built = await builder.build(AiChatTopic.RECENT_PROGRESS, child, caller, now);

    expect(todayFocus.get).not.toHaveBeenCalled();
    expect(weekly.summarise).toHaveBeenCalledWith('c1', caller, {}, now);
    expect(summaryThemes.read).toHaveBeenCalledWith('c1');
    expect(built.context.lastWeek).toEqual({ daysLogged: 5, sleepMinutesAverage: 500 });
    expect(built.context.recentThemes).toEqual(['sleep', 'routines']);
    expect(JSON.stringify(built.context)).not.toMatch(/followUp|Zephyrine/);
  });

  it('a child with no active plan is an empty plan, not an error', async () => {
    const { builder, todayFocus } = make();
    todayFocus.get.mockRejectedValue(
      new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'none' }),
    );

    const built = await builder.build(AiChatTopic.EVERYDAY_ROUTINES, child, caller, now);

    expect(built.context.planDay).toBeNull();
    expect(built.context.planOverview).toEqual({ sections: [], days: [] });
  });

  it('does not hide other failures, such as a refused caller', async () => {
    const { builder, todayFocus } = make();
    todayFocus.get.mockRejectedValue(new Error('boom'));

    await expect(builder.build(AiChatTopic.TODAYS_ACTIVITIES, child, caller, now)).rejects.toThrow(
      'boom',
    );
  });
});
