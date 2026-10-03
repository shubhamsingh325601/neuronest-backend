import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { UserDetailDto } from '@modules/users/shared/user-detail.dto';

/**
 * Admin detail view of a single user (C1, plan 0008) — embeds relations per §3 row 11:
 * a `PARENT`'s one child (if any, `Child.parentId @unique`), or a `CLINICIAN`'s live
 * `ClinicianChildAssignment` rows. Closes the "identity resolution gap" the phase-8
 * audit flagged — a bare UUID elsewhere in the system can now be resolved to something
 * actionable.
 */
@Injectable()
export class GetUserService {
  constructor(private readonly prisma: PrismaService) {}

  async getById(id: string): Promise<UserDetailDto> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'No user with that id.' });
    }

    let childId: string | null = null;
    let assignedChildIds: string[] = [];

    if (user.role === Role.PARENT) {
      const child = await this.prisma.child.findUnique({
        where: { parentId: user.id },
        select: { id: true },
      });
      childId = child?.id ?? null;
    } else if (user.role === Role.CLINICIAN) {
      const assignments = await this.prisma.clinicianChildAssignment.findMany({
        where: { clinicianId: user.id },
        select: { childId: true },
      });
      assignedChildIds = assignments.map((a) => a.childId);
    }

    return UserDetailDto.from(user, childId, assignedChildIds);
  }
}
