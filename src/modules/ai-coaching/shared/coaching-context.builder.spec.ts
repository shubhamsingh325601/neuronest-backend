import { NotFoundException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import type { ChildDto } from '@modules/children/shared/child.dto';
import { ageInYears, CoachingContextBuilder, INSTRUCTIONS_MAX } from './coaching-context.builder';

const now = new Date('2026-10-05T10:00:00Z');
const caller: AuthenticatedUser = {
  id: 'parent-1',
  email: 'parent@example.com',
  role: Role.PARENT,
  status: UserStatus.ACTIVE,
};
const child: ChildDto = {
  id: 'child-1',
  parentId: 'parent-1',
  name: 'Alex Johnson',
  dateOfBirth: new Date('2020-06-15T00:00:00Z'),
  // Profile fields that must never reach a prompt (sentinels asserted absent below).
  preferredName: 'SentinelNick',
  gender: 'SentinelGender',
  primaryLanguage: 'SentinelLanguage',
  accommodations: 'SentinelAccommodation',
  clinicalProfile: {
    currentStage: 'SentinelStage',
    observationSummary: 'SentinelObservation',
    primaryCareFocus: 'SentinelFocus',
    strengths: [{ label: 'SentinelStrength' }],
    sensoryTraits: [],
    calmingPreferences: [],
  } as unknown as ChildDto['clinicalProfile'],
  createdAt: now,
  updatedAt: now,
};

function make(overrides: { day?: unknown; tips?: unknown[]; average?: number | null } = {}) {
  const todayFocus = {
    get: jest.fn().mockResolvedValue({
      plan: { id: 'plan-1', childId: 'child-1', createdById: 'clinician-1', notes: 'private' },
      day:
        overrides.day === undefined
          ? {
              id: 'day-1',
              dayNumber: 4,
              title: 'Bedtime with Alex',
              instructions: 'Dim the lights. Alex likes a story. Johnson sleeps better.',
              sectionId: null,
              updatedAt: now,
            }
          : overrides.day,
    }),
  };
  const weeklySummary = {
    summarise: jest.fn().mockResolvedValue({
      weekStart: '2026-09-28',
      weekEnd: '2026-10-04',
      daysLogged: 5,
      mood: { average: 4, min: 1, max: 5 },
      behaviour: { average: 3, min: 1, max: 5 },
      sleepMinutes: { average: overrides.average === undefined ? 481.6 : overrides.average },
      trend: 'UP',
      activePlan: { id: 'plan-1', title: 'Secret plan title' },
    }),
  };
  const coaching = {
    list: jest.fn().mockResolvedValue({
      weekNumber: 1,
      tips: overrides.tips ?? [
        {
          id: 'tip-1',
          weekNumber: 1,
          position: 1,
          title: 'Visual timer',
          body: 'Use a timer with Alex.',
          authorId: 'clinician-1',
        },
      ],
    }),
  };
  const builder = new CoachingContextBuilder(
    todayFocus as never,
    weeklySummary as never,
    coaching as never,
  );
  return { builder, todayFocus, weeklySummary, coaching };
}

describe('CoachingContextBuilder', () => {
  it('returns exactly the allow-listed key set (plan 0018 Q6.3)', async () => {
    const { context } = await make().builder.build(child, caller, now);

    expect(Object.keys(context).sort()).toEqual([
      'ageYears',
      'clinicianTips',
      'lastWeek',
      'planDay',
    ]);
    expect(Object.keys(context.planDay!).sort()).toEqual(['dayNumber', 'instructions', 'title']);
    expect(Object.keys(context.lastWeek).sort()).toEqual(['daysLogged', 'sleepMinutesAverage']);
    expect(Object.keys(context.clinicianTips[0]).sort()).toEqual(['body', 'title']);
  });

  it('never carries an id, a name, the date of birth, mood/behaviour/trend or plan metadata', async () => {
    const { context } = await make().builder.build(child, caller, now);
    const json = JSON.stringify(context);

    for (const forbidden of [
      'child-1',
      'parent-1',
      'clinician-1',
      'plan-1',
      'Johnson',
      'Alex',
      '2020-06-15',
      'Sentinel',
      'Secret plan title',
      'private',
      'mood',
      'behaviour',
      'trend',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('computes values from the services and rounds the sleep average', async () => {
    const { context } = await make().builder.build(child, caller, now);

    expect(context.ageYears).toBe(6);
    expect(context.planDay).toMatchObject({ dayNumber: 4 });
    expect(context.lastWeek).toEqual({ daysLogged: 5, sleepMinutesAverage: 482 });
  });

  it('calls the existing services with the real caller, for the current coaching week', async () => {
    const { builder, todayFocus, weeklySummary, coaching } = make();

    await builder.build(child, caller, now);

    expect(todayFocus.get).toHaveBeenCalledWith('child-1', caller);
    expect(weeklySummary.summarise).toHaveBeenCalledWith('child-1', caller, {}, now);
    expect(coaching.list).toHaveBeenCalledWith('child-1', caller, {});
  });

  it("scrubs the child's name out of clinician-authored text", async () => {
    const { context, nameTokens } = await make().builder.build(child, caller, now);

    expect(context.planDay!.title).toBe('Bedtime with the child');
    expect(context.planDay!.instructions).toBe(
      'Dim the lights. the child likes a story. the child sleeps better.',
    );
    expect(context.clinicianTips[0].body).toBe('Use a timer with the child.');
    expect(nameTokens).toEqual(['Johnson', 'Alex']);
  });

  it('truncates long instructions and keeps at most three tips', async () => {
    const tips = Array.from({ length: 5 }, (_, i) => ({
      title: `T${i}`,
      body: `B${i}`,
    }));
    const { builder } = make({
      tips,
      day: {
        dayNumber: 1,
        title: 't',
        instructions: 'x'.repeat(INSTRUCTIONS_MAX + 500),
      },
    });

    const { context } = await builder.build(child, caller, now);

    expect(context.planDay!.instructions).toHaveLength(INSTRUCTIONS_MAX);
    expect(context.clinicianTips.map((t) => t.title)).toEqual(['T0', 'T1', 'T2']);
  });

  it('handles a day outside the plan and an unlogged week', async () => {
    const { context } = await make({ day: null, average: null, tips: [] }).builder.build(
      child,
      caller,
      now,
    );

    expect(context.planDay).toBeNull();
    expect(context.lastWeek.sleepMinutesAverage).toBeNull();
    expect(context.clinicianTips).toEqual([]);
  });

  it('propagates PLAN_NOT_FOUND from Today’s Focus', async () => {
    const { builder, todayFocus } = make();
    todayFocus.get.mockRejectedValue(
      new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'none' }),
    );

    await expect(builder.build(child, caller, now)).rejects.toThrow(NotFoundException);
  });

  describe('inputHash', () => {
    it('is stable for the same context and changes with the prompt version or the content', async () => {
      const a = await make().builder.build(child, caller, now);
      const b = await make().builder.build(child, caller, now);
      const edited = await make({
        day: { dayNumber: 4, title: 'Changed', instructions: 'New instructions' },
      }).builder.build(child, caller, now);

      expect(a.inputHash(1)).toBe(b.inputHash(1));
      expect(a.inputHash(1)).not.toBe(a.inputHash(2));
      expect(a.inputHash(1)).not.toBe(edited.inputHash(1));
      expect(a.inputHash(1)).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});

describe('ageInYears', () => {
  it('counts whole years and respects the birthday', () => {
    const dob = new Date('2020-06-15T00:00:00Z');
    expect(ageInYears(dob, new Date('2026-06-14T00:00:00Z'))).toBe(5);
    expect(ageInYears(dob, new Date('2026-06-15T00:00:00Z'))).toBe(6);
  });

  it('is null for a future date of birth', () => {
    expect(ageInYears(new Date('2030-01-01T00:00:00Z'), now)).toBeNull();
  });
});
