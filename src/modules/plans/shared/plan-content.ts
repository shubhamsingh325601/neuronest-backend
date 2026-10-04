import { BadRequestException } from '@nestjs/common';

export interface ContentSectionInput {
  title: string;
}
export interface ContentDayInput {
  dayNumber: number;
  title: string;
  instructions: string;
  sectionPosition?: number;
}

const invalid = (message: string): BadRequestException =>
  new BadRequestException({ code: 'VALIDATION_ERROR', message });

/**
 * Cross-row invariants for the one content shape shared by templates, plans and (future)
 * AI output (plan 0016 §3 row 3): unique dayNumbers, every `sectionPosition` points at a
 * real section, and — for templates — dayNumbers form a contiguous 1..N set.
 */
export function assertValidContent(
  sections: ContentSectionInput[],
  days: ContentDayInput[],
  opts: { contiguous: boolean },
): void {
  const numbers = days.map((d) => d.dayNumber).sort((a, b) => a - b);
  if (new Set(numbers).size !== numbers.length) {
    throw invalid('days[].dayNumber must be unique.');
  }
  if (opts.contiguous && !numbers.every((n, i) => n === i + 1)) {
    throw invalid('days[].dayNumber must be a contiguous 1..N set.');
  }
  for (const day of days) {
    if (day.sectionPosition !== undefined && day.sectionPosition > sections.length) {
      throw invalid('days[].sectionPosition must refer to an entry in sections[].');
    }
  }
}
