import { Injectable, NotFoundException } from '@nestjs/common';
import { AiChatTopic, SummaryStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ageInYears } from '@modules/ai-coaching/shared/coaching-context.builder';
import { nameTokens, scrubName, truncate } from '@modules/ai-coaching/shared/text-safety.util';
import type { ChildDto } from '@modules/children/shared/child.dto';
import { GetPlanService } from '@modules/plans/features/get-plan/get-plan.service';
import { TodayFocusService } from '@modules/plans/features/today-focus/today-focus.service';
import { WeeklySummaryService } from '@modules/progress/features/weekly-summary/weekly-summary.service';
import { SUMMARY_THEMES } from './conversation-summary.content';

const TITLE_MAX = 200;
const INSTRUCTIONS_MAX = 1500;
const MAX_SECTIONS = 10;
const MAX_DAY_TITLES = 30;
const RECENT_SUMMARIES = 3;
const MAX_THEMES = 5;

/**
 * The ONLY data that may enter a chat prompt (plan 0019 section 6.1 — an allow-list, not a deny-list).
 * Each topic gets its own subset. Never add: names, date of birth, ids, clinician notes, call logs,
 * appointments, media, parent notes or the text of any conversation.
 */
export interface ChatPromptContext {
  ageYears: number | null;
  /** Today's plan day: TODAYS_ACTIVITIES and EVERYDAY_ROUTINES. */
  planDay?: { dayNumber: number; title: string; instructions: string } | null;
  /** Section and day titles of the active plan: PLAN_EXPLAINER and EVERYDAY_ROUTINES. */
  planOverview?: { sections: string[]; days: { dayNumber: number; title: string }[] } | null;
  /** RECENT_PROGRESS only. */
  lastWeek?: { daysLogged: number; sleepMinutesAverage: number | null };
  /** RECENT_PROGRESS only: themes of the child's latest closed chats. */
  recentThemes?: string[];
}

/** What the domain services returned, before minimisation. Shared by the builder and the live eval. */
export interface RawChatInput {
  childName: string;
  ageYears: number | null;
  planDay: { dayNumber: number; title: string; instructions: string } | null;
  planSections: string[];
  planDays: { dayNumber: number; title: string }[];
  daysLogged: number;
  sleepMinutesAverage: number | null;
  themes: string[];
}

export interface BuiltChatContext {
  context: ChatPromptContext;
  /** The child's name parts, for the output name-leak check. Never sent to the model. */
  nameTokens: string[];
}

/**
 * The single place raw domain data becomes a chat context: topic allow-list, name scrub, truncation.
 * Pure, so the live eval builds exactly what production builds.
 */
export function assembleChatContext(topic: AiChatTopic, raw: RawChatInput): BuiltChatContext {
  const tokens = nameTokens(raw.childName);
  const clean = (text: string, max: number): string => truncate(scrubName(text, tokens), max);

  const planDay = raw.planDay
    ? {
        dayNumber: raw.planDay.dayNumber,
        title: clean(raw.planDay.title, TITLE_MAX),
        instructions: clean(raw.planDay.instructions, INSTRUCTIONS_MAX),
      }
    : null;
  const planOverview = {
    sections: raw.planSections.slice(0, MAX_SECTIONS).map((s) => clean(s, TITLE_MAX)),
    days: raw.planDays
      .slice(0, MAX_DAY_TITLES)
      .map((d) => ({ dayNumber: d.dayNumber, title: clean(d.title, TITLE_MAX) })),
  };

  const context: ChatPromptContext = { ageYears: raw.ageYears };
  switch (topic) {
    case AiChatTopic.TODAYS_ACTIVITIES:
      context.planDay = planDay;
      break;
    case AiChatTopic.PLAN_EXPLAINER:
      context.planOverview = planOverview;
      break;
    case AiChatTopic.RECENT_PROGRESS:
      context.lastWeek = {
        daysLogged: raw.daysLogged,
        sleepMinutesAverage:
          raw.sleepMinutesAverage === null ? null : Math.round(raw.sleepMinutesAverage),
      };
      context.recentThemes = raw.themes.slice(0, MAX_THEMES);
      break;
    case AiChatTopic.EVERYDAY_ROUTINES:
      context.planDay = planDay;
      context.planOverview = planOverview;
      break;
  }
  return { context, nameTokens: tokens };
}

/**
 * Assembles a topic's prompt context by calling the existing domain services with the real caller
 * (plan 0018 Q3.2), never their tables, so every ownership rule applies as on the parent's own
 * screens. A child without an active plan is a normal chat with an empty plan, not an error.
 */
@Injectable()
export class AiChatContextBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly todayFocus: TodayFocusService,
    private readonly plans: GetPlanService,
    private readonly weeklySummary: WeeklySummaryService,
  ) {}

  async build(
    topic: AiChatTopic,
    child: ChildDto,
    caller: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<BuiltChatContext> {
    const raw: RawChatInput = {
      childName: child.name,
      ageYears: ageInYears(child.dateOfBirth, now),
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
          raw.planDays = plan.days.map((d) => ({ dayNumber: d.dayNumber, title: d.title }));
        }
      }
    }

    if (topic === AiChatTopic.RECENT_PROGRESS) {
      const summary = await this.weeklySummary.summarise(child.id, caller, {}, now);
      raw.daysLogged = summary.daysLogged;
      raw.sleepMinutesAverage = summary.sleepMinutes.average;
      raw.themes = await this.recentThemes(child.id);
    }

    return assembleChatContext(topic, raw);
  }

  /** Themes only (a fixed taxonomy), from the latest READY summaries of this child. */
  private async recentThemes(childId: string): Promise<string[]> {
    const summaries = await this.prisma.conversationSummary.findMany({
      where: { childId, status: SummaryStatus.READY },
      orderBy: { generatedAt: 'desc' },
      take: RECENT_SUMMARIES,
      select: { content: true },
    });
    const themes = new Set<string>();
    for (const { content } of summaries) {
      const list = (content as { themes?: unknown } | null)?.themes;
      if (!Array.isArray(list)) continue;
      for (const theme of list) {
        if (typeof theme === 'string' && (SUMMARY_THEMES as readonly string[]).includes(theme)) {
          themes.add(theme);
        }
      }
    }
    return [...themes];
  }
}
