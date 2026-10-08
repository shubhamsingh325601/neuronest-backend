import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { instanceToPlain } from 'class-transformer';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ChildDto } from '@modules/children/shared/child.dto';
import { ClinicalProfileDto } from '@modules/children/shared/clinical-profile.dto';

/** Assigned clinician (or admin) replaces the clinician-authored profile wholesale (idempotent PUT). */
@Injectable()
export class SetClinicalProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async set(
    childId: string,
    caller: AuthenticatedUser,
    dto: ClinicalProfileDto,
  ): Promise<ChildDto> {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: { id: true },
    });
    if (!child) {
      throw new NotFoundException({ code: 'CHILD_NOT_FOUND', message: 'No child with that id.' });
    }

    if (caller.role === Role.CLINICIAN) {
      const assignment = await this.prisma.clinicianChildAssignment.findUnique({
        where: { clinicianId_childId: { clinicianId: caller.id, childId } },
        select: { id: true },
      });
      if (!assignment) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You do not have permission to access this resource.',
        });
      }
    } else if (caller.role !== Role.ADMIN) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this resource.',
      });
    }

    const updated = await this.prisma.child.update({
      where: { id: childId },
      data: { clinicalProfile: instanceToPlain(dto) as Prisma.InputJsonValue },
    });
    return ChildDto.from(updated);
  }
}
