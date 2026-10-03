import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';

/**
 * Admin hard-deletes a clinician's assignment to a child (§3 row 5 of plan 0008). The
 * child must exist (`404 CHILD_NOT_FOUND`); the assignment row itself is idempotent —
 * deleting one that's already gone is still success, per api-conventions.md's DELETE
 * semantics. No `revokedAt` column — this is a real delete, not a soft one.
 */
@Injectable()
export class RevokeClinicianAssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  async revoke(childId: string, clinicianId: string): Promise<void> {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: { id: true },
    });
    if (!child) {
      throw new NotFoundException({ code: 'CHILD_NOT_FOUND', message: 'No child with that id.' });
    }

    await this.prisma.clinicianChildAssignment.deleteMany({
      where: { clinicianId, childId },
    });
  }
}
