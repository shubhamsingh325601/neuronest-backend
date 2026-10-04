import { Prisma } from '@prisma/client';
import type { ContentDayInput, ContentSectionInput } from './plan-content';

/** Writes sections then days for a template inside the caller's transaction. */
export async function writeTemplateContent(
  tx: Prisma.TransactionClient,
  planTemplateId: string,
  sections: ContentSectionInput[],
  days: ContentDayInput[],
): Promise<void> {
  const sectionIdByPosition = new Map<number, string>();
  for (const [i, section] of sections.entries()) {
    const created = await tx.planTemplateSection.create({
      data: { planTemplateId, title: section.title.trim(), position: i + 1 },
      select: { id: true },
    });
    sectionIdByPosition.set(i + 1, created.id);
  }
  if (days.length > 0) {
    await tx.planTemplateDay.createMany({
      data: days.map((day) => ({
        planTemplateId,
        sectionId: day.sectionPosition ? sectionIdByPosition.get(day.sectionPosition) : undefined,
        dayNumber: day.dayNumber,
        title: day.title.trim(),
        instructions: day.instructions.trim(),
      })),
    });
  }
}
