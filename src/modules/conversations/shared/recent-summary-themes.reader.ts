import { Injectable } from '@nestjs/common';
import { SummaryStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { SUMMARY_THEMES } from './conversation-summary.content';

const RECENT_SUMMARIES = 3;

/** The only two things about a closed chat that other features may use as AI context (plan 0019 section 7). */
export interface RecentSummarySignals {
  /** Fixed-taxonomy themes of the child's latest READY summaries, de-duplicated. */
  themes: string[];
  followUpSuggested: boolean;
}

/**
 * Reads themes and the follow-up flag from a child's latest READY summaries and nothing else: no overview,
 * concerns, guidance or questions ever leave this class. Callers must already have authorised access to
 * the child. Values outside the taxonomy are dropped, so free text cannot ride along.
 */
@Injectable()
export class RecentSummaryThemesReader {
  constructor(private readonly prisma: PrismaService) {}

  async read(childId: string): Promise<RecentSummarySignals> {
    const summaries = await this.prisma.conversationSummary.findMany({
      where: { childId, status: SummaryStatus.READY },
      orderBy: { generatedAt: 'desc' },
      take: RECENT_SUMMARIES,
      select: { content: true },
    });
    const themes = new Set<string>();
    let followUpSuggested = false;
    for (const { content } of summaries) {
      const parsed = content as { themes?: unknown; followUpSuggested?: unknown } | null;
      if (parsed?.followUpSuggested === true) followUpSuggested = true;
      const list = parsed?.themes;
      if (!Array.isArray(list)) continue;
      for (const theme of list) {
        if (typeof theme === 'string' && (SUMMARY_THEMES as readonly string[]).includes(theme)) {
          themes.add(theme);
        }
      }
    }
    return { themes: [...themes], followUpSuggested };
  }
}
