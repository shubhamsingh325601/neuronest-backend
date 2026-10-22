import { Injectable, NotFoundException } from '@nestjs/common';
import { AiChatTopic } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ageInYears } from '@modules/ai-coaching/shared/coaching-context.builder';
import { truncate } from '@modules/ai-coaching/shared/text-safety.util';
import type { ChildDto } from '@modules/children/shared/child.dto';
import type { ClinicalProfileDto } from '@modules/children/shared/clinical-profile.dto';
import { GetPlanService } from '@modules/plans/features/get-plan/get-plan.service';
import { TodayFocusService } from '@modules/plans/features/today-focus/today-focus.service';
import { WeeklySummaryService } from '@modules/progress/features/weekly-summary/weekly-summary.service';
import { RecentSummaryThemesReader } from './recent-summary-themes.reader';

const TITLE_MAX = 200;
const INSTRUCTIONS_MAX = 1500;
/** All day instructions of one PLAN_EXPLAINER prompt together; days past it are listed by title only. */
const INSTRUCTIONS_BUDGET = 8000;
const MAX_SECTIONS = 10;
const MAX_DAY_TITLES = 30;
const MAX_THEMES = 5;
const NAME_MAX = 60;
const PROFILE_LINE_MAX = 300;
const MAX_PROFILE_LINES = 8;

/**
 * The ONLY data that may enter a chat prompt (plan 0019 section 6.1, widened by plan 0020 section 6.1 — an
 * allow-list, not a deny-list). Each topic gets its own subset. Care-team names are never sent (the child's and
 * parent's first names are, for test data only until launch gate G1). Never add: full names, date of birth, ids,
 * clinician notes (`observationSummary`), the parent's `accommodations` text, call logs, appointments, media or
 * the text of any conversation.
 */
export interface ChatPromptContext {
  ageYears: number | null;
  /** Every topic. */
  family: { parentName: string; childName: string; gender: string | null };
  /** Today's plan day: TODAYS_ACTIVITIES and EVERYDAY_ROUTINES. */
  planDay?: { dayNumber: number; title: string; instructions: string } | null;
  /** Section and day titles of the active plan (PLAN_EXPLAINER adds the day instructions). */
  planOverview?: {
    sections: string[];
    days: { dayNumber: number; title: string; instructions?: string }[];
  } | null;
  /** The clinician's profile of the child, a different subset per topic. */
  profile?: {
    currentStage?: string;
    primaryCareFocus?: string;
    strengths?: string[];
    sensoryTraits?: string[];
    calmingPreferences?: string[];
    communication?: string[];
  };
  /** RECENT_PROGRESS only. */
  lastWeek?: { daysLogged: number; sleepMinutesAverage: number | null };
  /** RECENT_PROGRESS only: themes of the child's latest closed chats. */
  recentThemes?: string[];
}

/** What the domain services returned, before minimisation. Shared by the builder and the live eval. */
export interface RawChatInput {
  parentName: string;
  childName: string;
  gender: string | null;
  ageYears: number | null;
  profile: ClinicalProfileDto | null;
  planDay: { dayNumber: number; title: string; instructions: string } | null;
  planSections: string[];
  planDays: { dayNumber: number; title: string; instructions: string }[];
  daysLogged: number;
  sleepMinutesAverage: number | null;
  themes: string[];
}

/** First names for the prompt and the greeting: the parent's first word, the child's preferred name or first word. */
export function chatFirstNames(
  child: Pick<ChildDto, 'name' | 'preferredName'>,
  parentFullName: string,
): { parentName: string; childName: string } {
  const first = (name: string): string => name.trim().split(/\s+/)[0] ?? '';
  return {
    parentName: first(parentFullName),
    childName: child.preferredName?.trim() || first(child.name),
  };
}

/**
 * The single place raw domain data becomes a chat context: topic allow-list and truncation.
 * Pure, so the live eval builds exactly what production builds.
 */
export function assembleChatContext(topic: AiChatTopic, raw: RawChatInput): ChatPromptContext {
  const line = (text: string): string => truncate(text, PROFILE_LINE_MAX);
  const p = raw.profile;
  const strengths = (p?.strengths ?? [])
    .slice(0, MAX_PROFILE_LINES)
    .map((s) => line(`${s.title}: ${s.description}`));
  const sensoryTraits = (p?.sensoryTraits ?? [])
    .slice(0, MAX_PROFILE_LINES)
    .map((s) =>
      line(
        `${s.domain} (${s.sensitivityLevel.toLowerCase()}), triggers: ${s.triggers.join(', ') || 'none listed'}`,
      ),
    );
  const calmingPreferences = (p?.calmingPreferences ?? [])
    .slice(0, MAX_PROFILE_LINES)
    .map((c) => line(`${c.title}: ${c.technique}`));
  const communication = p?.communication
    ? [
        line(`Speaks: ${p.communication.expressiveMode}`),
        line(`Understands: ${p.communication.receptiveUnderstanding}`),
        ...p.communication.preferredPrompts.slice(0, MAX_PROFILE_LINES).map(line),
      ]
    : [];

  const planDay = raw.planDay
    ? {
        dayNumber: raw.planDay.dayNumber,
        title: truncate(raw.planDay.title, TITLE_MAX),
        instructions: truncate(raw.planDay.instructions, INSTRUCTIONS_MAX),
      }
    : null;
  let budget = INSTRUCTIONS_BUDGET;
  const planOverview = (withInstructions: boolean) => ({
    sections: raw.planSections.slice(0, MAX_SECTIONS).map((s) => truncate(s, TITLE_MAX)),
    days: raw.planDays.slice(0, MAX_DAY_TITLES).map((d) => {
      const day = { dayNumber: d.dayNumber, title: truncate(d.title, TITLE_MAX) };
      if (!withInstructions || budget <= 0) return day;
      const instructions = truncate(d.instructions, Math.min(INSTRUCTIONS_MAX, budget));
      budget -= instructions.length;
      return { ...day, instructions };
    }),
  });

  const context: ChatPromptContext = {
    ageYears: raw.ageYears,
    family: {
      parentName: truncate(raw.parentName, NAME_MAX),
      childName: truncate(raw.childName, NAME_MAX),
      gender: raw.gender && truncate(raw.gender, NAME_MAX),
    },
  };
  switch (topic) {
    case AiChatTopic.TODAYS_ACTIVITIES:
      context.planDay = planDay;
      context.profile = { strengths, sensoryTraits, calmingPreferences };
      break;
    case AiChatTopic.PLAN_EXPLAINER:
      context.planOverview = planOverview(true);
      context.profile = {
        currentStage: p?.currentStage && line(p.currentStage),
        primaryCareFocus: p?.primaryCareFocus && line(p.primaryCareFocus),
      };
      break;
    case AiChatTopic.RECENT_PROGRESS:
      context.lastWeek = {
        daysLogged: raw.daysLogged,
        sleepMinutesAverage:
          raw.sleepMinutesAverage === null ? null : Math.round(raw.sleepMinutesAverage),
      };
      context.recentThemes = raw.themes.slice(0, MAX_THEMES);
      context.profile = {
        strengths,
        primaryCareFocus: p?.primaryCareFocus && line(p.primaryCareFocus),
      };
      break;
    case AiChatTopic.EVERYDAY_ROUTINES:
      context.planDay = planDay;
      context.planOverview = planOverview(false);
      context.profile = { sensoryTraits, calmingPreferences, communication };
      break;
  }
  return context;
}

/**
 * Assembles a topic's prompt context by calling the existing domain services with the real caller
 * (plan 0018 Q3.2), never their tables, so every ownership rule applies as on the parent's own
 * screens. A child without an active plan is a normal chat with an empty plan, not an error. The one
 * direct read is the caller's own name (their row, `name` only): no domain service exposes it.
 */
@Injectable()
export class AiChatContextBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaryThemes: RecentSummaryThemesReader,
    private readonly todayFocus: TodayFocusService,
    private readonly plans: GetPlanService,
    private readonly weeklySummary: WeeklySummaryService,
  ) {}

  async build(
    topic: AiChatTopic,
    child: ChildDto,
    caller: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<ChatPromptContext> {
    const parent = await this.prisma.user.findUniqueOrThrow({
      where: { id: caller.id },
      select: { name: true },
    });
    const raw: RawChatInput = {
      ...chatFirstNames(child, parent.name),
      gender: child.gender,
      ageYears: ageInYears(child.dateOfBirth, now),
      profile: child.clinicalProfile,
      planDay: null,
      planSections: [],
      planDays: [],
      daysLogged: 0,
      sleepMinutesAverage: null,
      themes: [],
    };

    const needsPlan =
      topic === AiChatTopic.TODAYS_ACTIVITIES ||
      topic === AiChatTopic.PLAN_EXPLAINER ||
      topic === AiChatTopic.EVERYDAY_ROUTINES;
    if (needsPlan) {
      const today = await this.todayFocus.get(child.id, caller).catch((err: unknown) => {
        if (err instanceof NotFoundException) return null; // PLAN_NOT_FOUND: no active plan yet
        throw err;
      });
      if (today) {
        if (today.day) {
          raw.planDay = {
            dayNumber: today.day.dayNumber,
            title: today.day.title,
            instructions: today.day.instructions,
          };
        }
        if (topic !== AiChatTopic.TODAYS_ACTIVITIES) {
          const plan = await this.plans.getById(today.plan.id, caller);
          raw.planSections = plan.sections.map((s) => s.title);
          raw.planDays = plan.days.map((d) => ({
            dayNumber: d.dayNumber,
            title: d.title,
            instructions: d.instructions,
          }));
        }
      }
    }

    if (topic === AiChatTopic.RECENT_PROGRESS) {
      const summary = await this.weeklySummary.summarise(child.id, caller, {}, now);
      raw.daysLogged = summary.daysLogged;
      raw.sleepMinutesAverage = summary.sleepMinutes.average;
      raw.themes = (await this.summaryThemes.read(child.id)).themes;
    }

    return assembleChatContext(topic, raw);
  }
}
