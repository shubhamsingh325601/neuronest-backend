import { Prisma } from '@prisma/client';

/**
 * Copy-on-assign (plan 0016 §3 row 2): writes the template's sections and days into
 * plan-owned rows so later template changes never alter the plan, and the clinician
 * can tailor the child's copy. Runs inside the caller's transaction.
 */
export async function snapshotTemplateIntoPlan(
  tx: Prisma.TransactionClient,
  planTemplateId: string,
  planId: string,
): Promise<void> {
  const [sections, days] = await Promise.all([
    tx.planTemplateSection.findMany({ where: { planTemplateId } }),
    tx.planTemplateDay.findMany({ where: { planTemplateId } }),
  ]);

  const planSectionIdByTemplateSectionId = new Map<string, string>();
  for (const section of sections) {
    const created = await tx.planSection.create({
      data: { planId, title: section.title, position: section.position },
      select: { id: true },
    });
    planSectionIdByTemplateSectionId.set(section.id, created.id);
  }

  if (days.length > 0) {
    await tx.planDay.createMany({
      data: days.map((day) => ({
        planId,
        sectionId: day.sectionId ? planSectionIdByTemplateSectionId.get(day.sectionId) : undefined,
        dayNumber: day.dayNumber,
        title: day.title,
        instructions: day.instructions,
      })),
    });
  }
}
