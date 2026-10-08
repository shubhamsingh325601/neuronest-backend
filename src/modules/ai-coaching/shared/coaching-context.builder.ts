import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { sha256 } from '@common/crypto/token.util';
import type { ChildDto } from '@modules/children/shared/child.dto';
import { ListCoachingService } from '@modules/coaching/features/list-coaching/list-coaching.service';
import { TodayFocusService } from '@modules/plans/features/today-focus/today-focus.service';
import { WeeklySummaryService } from '@modules/progress/features/weekly-summary/weekly-summary.service';
import { nameTokens, scrubName, truncate } from './text-safety.util';

export const INSTRUCTIONS_MAX = 1500;
const TITLE_MAX = 200;
const TIP_BODY_MAX = 800;
const MAX_TIPS = 3;

/**
 * The ONLY data that may enter a coaching-tip prompt (plan 0018 Q6.3 — an allow-list, not a
 * deny-list). Never add: child name or date of birth, parent or clinician details, any id,
 * progress notes, plan notes, call logs, appointments, media, consent history. Mood, behaviour
 * and trend are withheld until their scale polarity is decided (plan 0018 O-4).
 */
export interface CoachingPromptContext {
  ageYears: number | null;
  planDay: { dayNumber: number; title: string; instructions: string } | null;
  lastWeek: { daysLogged: number; sleepMinutesAverage: number | null };
  clinicianTips: { title: string; body: string }[];
}

export interface BuiltCoachingContext {
  context: CoachingPromptContext;
  /** The child's name parts, for the output name-leak check. Never sent to the model. */
  nameTokens: string[];
  /** sha256 of the context plus the prompt version; decides whether a regeneration is warranted. */
  inputHash: (promptVersion: number) => string;
}

/** Whole years between `dob` and `now` (UTC); null for a date of birth in the future. */
export function ageInYears(dob: Date, now: Date): number | null {
  let years = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) years -= 1;
  return years < 0 ? null : years;
}

/** What the domain services returned, before minimisation. Shared by the builder and the eval harness. */
export interface RawCoachingInput {
  childName: string;
  ageYears: number | null;
  planDay: { dayNumber: number; title: string; instructions: string } | null;
  daysLogged: number;
  sleepMinutesAverage: number | null;
  clinicianTips: { title: string; body: string }[];
}

/**
 * The single place raw domain data becomes a prompt context: name scrub, truncation, tip cap
 * and the input hash. Pure, so the live eval and the CI contract tests build exactly what
 * production builds.
 */
export function assembleCoachingContext(raw: RawCoachingInput): BuiltCoachingContext {
  const tokens = nameTokens(raw.childName);
  const clean = (text: string, max: number): string => truncate(scrubName(text, tokens), max);

  const context: CoachingPromptContext = {
    ageYears: raw.ageYears,
    planDay: raw.planDay
      ? {
          dayNumber: raw.planDay.dayNumber,
          title: clean(raw.planDay.title, TITLE_MAX),
          instructions: clean(raw.planDay.instructions, INSTRUCTIONS_MAX),
        }
      : null,
    lastWeek: {
      daysLogged: raw.daysLogged,
      sleepMinutesAverage:
        raw.sleepMinutesAverage === null ? null : Math.round(raw.sleepMinutesAverage),
    },
    clinicianTips: raw.clinicianTips.slice(0, MAX_TIPS).map((t) => ({
      title: clean(t.title, TITLE_MAX),
      body: clean(t.body, TIP_BODY_MAX),
    })),
  };

  return {
    context,
    nameTokens: tokens,
    inputHash: (promptVersion) => sha256(JSON.stringify({ context, promptVersion })),
  };
}

/**
 * Assembles the minimised prompt context by calling the existing domain services with the real
 * caller (plan 0018 Q3.2/Q12.3) — never Prisma — so every ownership rule and `404 PLAN_NOT_FOUND`
 * applies exactly as it does for the parent's own screens. The child comes from `GetChildService`
 * (via `AiAccessService`), already authorised for this caller.
 */
@Injectable()
export class CoachingContextBuilder {
  constructor(
    private readonly todayFocus: TodayFocusService,
    private readonly weeklySummary: WeeklySummaryService,
    private readonly coaching: ListCoachingService,
  ) {}

  async build(
    child: ChildDto,
    caller: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<BuiltCoachingContext> {
    const today = await this.todayFocus.get(child.id, caller);
    const [summary, tips] = await Promise.all([
      this.weeklySummary.summarise(child.id, caller, {}, now),
      this.coaching.list(child.id, caller, {}),
    ]);

    return assembleCoachingContext({
      childName: child.name,
      ageYears: ageInYears(child.dateOfBirth, now),
      planDay: today.day
        ? {
            dayNumber: today.day.dayNumber,
            title: today.day.title,
            instructions: today.day.instructions,
          }
        : null,
      daysLogged: summary.daysLogged,
      sleepMinutesAverage: summary.sleepMinutes.average,
      clinicianTips: tips.tips.map((t) => ({ title: t.title, body: t.body })),
    });
  }
}
