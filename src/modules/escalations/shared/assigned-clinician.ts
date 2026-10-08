import { Role } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';

/** The name of the clinician assigned to the child (the earliest assignment), or `null`. */
export async function assignedClinicianName(
  prisma: PrismaService,
  childId: string,
): Promise<string | null> {
  const assignment = await prisma.clinicianChildAssignment.findFirst({
    where: { childId, clinician: { role: Role.CLINICIAN } },
    orderBy: { createdAt: 'asc' },
    select: { clinician: { select: { name: true } } },
  });
  return assignment?.clinician.name ?? null;
}
