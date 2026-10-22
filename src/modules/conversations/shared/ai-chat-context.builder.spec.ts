import { NotFoundException } from '@nestjs/common';
import { AiChatTopic, Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import type { ChildDto } from '@modules/children/shared/child.dto';
import type { ClinicalProfileDto } from '@modules/children/shared/clinical-profile.dto';
import {
  AiChatContextBuilder,
  assembleChatContext,
  chatFirstNames,
  type RawChatInput,
} from './ai-chat-context.builder';

const profile: ClinicalProfileDto = {
  currentStage: 'Building routines',
  observationSummary: 'SentinelObservation',
  primaryCareFocus: 'Calm evenings',
  strengths: [{ title: 'Music', description: 'Loves singing' }],
  sensoryTraits: [
    {
      domain: 'Auditory',
      sensitivityLevel: 'HIGH',
      triggers: ['Loud noises'],
      accommodations: ['SentinelAccommodation'],
    },
  ],
  calmingPreferences: [{ title: 'Deep pressure', technique: 'A firm hug' }],
  communication: {
    expressiveMode: 'Short phrases',
    receptiveUnderstanding: 'Follows two steps',
    preferredPrompts: ['Show, then tell'],
  },
};

const raw: RawChatInput = {
  parentName: 'Meera',
  childName: 'Zeph',
  gender: 'Female',
  ageYears: 6,
  profile,
  planDay: {
    dayNumber: 3,
    title: 'Bedtime',
    instructions: 'Ask Zeph to pick a story.',
  },
  planSections: ['Week 1: Settling', 'Week 2'],
  planDays: [
    { dayNumber: 1, title: 'Wind down', instructions: 'Dim the lights.' },
    { dayNumber: 2, title: 'Story time', instructions: 'Read one story.' },
  ],
  daysLogged: 4,
  sleepMinutesAverage: 479.6,
  themes: ['sleep', 'routines'],
};

const family = { parentName: 'Meera', childName: 'Zeph', gender: 'Female' };

describe('assembleChatContext (the allow-list per topic)', () => {
  it('TODAYS_ACTIVITIES: family, today, strengths, sensory traits, calming preferences', () => {
    const context = assembleChatContext(AiChatTopic.TODAYS_ACTIVITIES, raw);

    expect(context).toEqual({
      ageYears: 6,
      family,
      planDay: { dayNumber: 3, title: 'Bedtime', instructions: 'Ask Zeph to pick a story.' },
      profile: {
        strengths: ['Music: Loves singing'],
        sensoryTraits: ['Auditory (high), triggers: Loud noises'],
        calmingPreferences: ['Deep pressure: A firm hug'],
      },
    });
  });

  it('PLAN_EXPLAINER: section titles, day titles with instructions, stage and focus', () => {
    const context = assembleChatContext(AiChatTopic.PLAN_EXPLAINER, raw);

    expect(context).toEqual({
      ageYears: 6,
      family,
      planOverview: {
        sections: ['Week 1: Settling', 'Week 2'],
        days: [
          { dayNumber: 1, title: 'Wind down', instructions: 'Dim the lights.' },
          { dayNumber: 2, title: 'Story time', instructions: 'Read one story.' },
        ],
      },
      profile: { currentStage: 'Building routines', primaryCareFocus: 'Calm evenings' },
    });
  });

  it('RECENT_PROGRESS: last week, themes, strengths and care focus', () => {
    const context = assembleChatContext(AiChatTopic.RECENT_PROGRESS, raw);

    expect(context).toEqual({
      ageYears: 6,
      family,
      lastWeek: { daysLogged: 4, sleepMinutesAverage: 480 },
      recentThemes: ['sleep', 'routines'],
      profile: { strengths: ['Music: Loves singing'], primaryCareFocus: 'Calm evenings' },
    });
  });

  it('EVERYDAY_ROUTINES: today, plan titles only, sensory traits, calming preferences, communication', () => {
    const context = assembleChatContext(AiChatTopic.EVERYDAY_ROUTINES, raw);

    expect(Object.keys(context).sort()).toEqual([
      'ageYears',
      'family',
      'planDay',
      'planOverview',
      'profile',
    ]);
    expect(context.planOverview?.days).toEqual([
      { dayNumber: 1, title: 'Wind down' },
      { dayNumber: 2, title: 'Story time' },
    ]);
    expect(Object.keys(context.profile ?? {}).sort()).toEqual([
      'calmingPreferences',
      'communication',
      'sensoryTraits',
    ]);
    expect(context.profile?.communication).toEqual([
      'Speaks: Short phrases',
      'Understands: Follows two steps',
      'Show, then tell',
    ]);
  });

  it('never carries clinician notes, the sensory accommodations, or a full name', () => {
    for (const topic of Object.values(AiChatTopic)) {
      const text = JSON.stringify(
        assembleChatContext(topic, { ...raw, parentName: 'Meera', childName: 'Zeph' }),
      );
      expect(text).not.toMatch(/SentinelObservation|SentinelAccommodation|Rao/);
    }
  });

  it('a child without a clinical profile still gets a context', () => {
    const context = assembleChatContext(AiChatTopic.TODAYS_ACTIVITIES, { ...raw, profile: null });

    expect(context.profile).toEqual({
      strengths: [],
      sensoryTraits: [],
      calmingPreferences: [],
    });
  });

  it('caps the number and length of titles', () => {
    const { planOverview } = assembleChatContext(AiChatTopic.PLAN_EXPLAINER, {
      ...raw,
      planSections: Array.from({ length: 20 }, (_, i) => `S${i}`),
      planDays: Array.from({ length: 50 }, (_, i) => ({
        dayNumber: i + 1,
        title: 'x'.repeat(500),
        instructions: '',
      })),
    });

    expect(planOverview?.sections).toHaveLength(10);
    expect(planOverview?.days).toHaveLength(30);
    expect(planOverview?.days[0].title).toHaveLength(200);
  });

  it('keeps all day instructions within one character budget; later days are titles only', () => {
    const { planOverview } = assembleChatContext(AiChatTopic.PLAN_EXPLAINER, {
      ...raw,
      planDays: Array.from({ length: 30 }, (_, i) => ({
        dayNumber: i + 1,
        title: `Day ${i + 1}`,
        instructions: 'y'.repeat(2000),
      })),
    });

    const days = planOverview?.days ?? [];
    expect(days[0].instructions).toHaveLength(1500);
    expect(days.reduce((sum, d) => sum + (d.instructions?.length ?? 0), 0)).toBeLessThanOrEqual(
      8000,
    );
    expect(days[29].instructions).toBeUndefined();
  });
});

describe('chatFirstNames', () => {
  it('uses the first word of the parent name, and the preferred name of the child before its first word', () => {
    expect(chatFirstNames({ name: 'Zephyrine Rao', preferredName: 'Zeph' }, 'Meera  Rao')).toEqual({
      parentName: 'Meera',
      childName: 'Zeph',
    });
    expect(chatFirstNames({ name: 'Zephyrine Rao', preferredName: null }, 'Meera Rao')).toEqual({
      parentName: 'Meera',
      childName: 'Zephyrine',
    });
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
    preferredName: 'Zeph',
    gender: 'Female',
    dateOfBirth: new Date('2019-05-14'),
    clinicalProfile: profile,
  } as unknown as ChildDto;
  const now = new Date('2026-10-11T00:00:00Z');

  function make() {
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Meera Rao' }) },
    };
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
        days: [{ dayNumber: 1, title: 'Wind down', instructions: 'Lights low.' }],
      }),
    };
    const weekly = {
      summarise: jest.fn().mockResolvedValue({ daysLogged: 5, sleepMinutes: { average: 500 } }),
    };
    const builder = new AiChatContextBuilder(
      prisma as never,
      summaryThemes as never,
      todayFocus as never,
      plans as never,
      weekly as never,
    );
    return { builder, prisma, summaryThemes, todayFocus, plans, weekly };
  }

  it('calls the domain services with the real caller, and only the ones the topic needs', async () => {
    const { builder, prisma, todayFocus, plans, weekly } = make();

    const context = await builder.build(AiChatTopic.TODAYS_ACTIVITIES, child, caller, now);

    expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'p1' },
      select: { name: true },
    });
    expect(todayFocus.get).toHaveBeenCalledWith('c1', caller);
    expect(plans.getById).not.toHaveBeenCalled();
    expect(weekly.summarise).not.toHaveBeenCalled();
    expect(context.planDay).toMatchObject({ dayNumber: 3, title: 'Bedtime' });
    expect(context.ageYears).toBe(7);
    expect(context.family).toEqual({
      parentName: 'Meera',
      childName: 'Zeph',
      gender: 'Female',
    });
  });

  it('loads the plan overview, with day instructions, for PLAN_EXPLAINER', async () => {
    const { builder, plans } = make();

    const context = await builder.build(AiChatTopic.PLAN_EXPLAINER, child, caller, now);

    expect(plans.getById).toHaveBeenCalledWith('plan-1', caller);
    expect(context.planOverview).toEqual({
      sections: ['Week 1'],
      days: [{ dayNumber: 1, title: 'Wind down', instructions: 'Lights low.' }],
    });
  });

  it('RECENT_PROGRESS: last week plus the themes of ready summaries, themes only', async () => {
    const { builder, summaryThemes, weekly, todayFocus } = make();
    summaryThemes.read.mockResolvedValue({
      themes: ['sleep', 'routines'],
      followUpSuggested: true,
    });

    const context = await builder.build(AiChatTopic.RECENT_PROGRESS, child, caller, now);

    expect(todayFocus.get).not.toHaveBeenCalled();
    expect(weekly.summarise).toHaveBeenCalledWith('c1', caller, {}, now);
    expect(summaryThemes.read).toHaveBeenCalledWith('c1');
    expect(context.lastWeek).toEqual({ daysLogged: 5, sleepMinutesAverage: 500 });
    expect(context.recentThemes).toEqual(['sleep', 'routines']);
    expect(JSON.stringify(context)).not.toMatch(/followUp|Rao/);
  });

  it('a child with no active plan is an empty plan, not an error', async () => {
    const { builder, todayFocus } = make();
    todayFocus.get.mockRejectedValue(
      new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'none' }),
    );

    const context = await builder.build(AiChatTopic.EVERYDAY_ROUTINES, child, caller, now);

    expect(context.planDay).toBeNull();
    expect(context.planOverview).toEqual({ sections: [], days: [] });
  });

  it('does not hide other failures, such as a refused caller', async () => {
    const { builder, todayFocus } = make();
    todayFocus.get.mockRejectedValue(new Error('boom'));

    await expect(builder.build(AiChatTopic.TODAYS_ACTIVITIES, child, caller, now)).rejects.toThrow(
      'boom',
    );
  });
});
