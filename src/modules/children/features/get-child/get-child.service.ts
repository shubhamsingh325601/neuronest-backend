import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ChildDto } from '@modules/children/shared/child.dto';

/**
 * Reads a single child. `child:read` is one permission granted to PARENT, CLINICIAN,
 * and ADMIN alike — the guard only checks the caller's role holds it. Ownership is
 * enforced here, per role (see docs/rbac.md §6):
 * - PARENT: must be the child's own parent.
 * - CLINICIAN: must have a live ClinicianChildAssignment for this child.
 * - ADMIN: unconditional.
 */
@Injectable()
export class GetChildService {
  constructor(private readonly prisma: PrismaService) {}

  async getById(id: string, caller: AuthenticatedUser): Promise<ChildDto> {
    const child = await this.prisma.child.findUnique({ where: { id } });
    if (!child) {
      throw new NotFoundException({
        code: 'CHILD_NOT_FOUND',
        message: 'No child with that id.',
      });
    }

    if (caller.role === Role.ADMIN) {
      return ChildDto.from(child);
    }

    if (caller.role === Role.PARENT) {
      if (child.parentId !== caller.id) {
        throw this.forbidden();
      }
      return ChildDto.from(child);
    }

    // CLINICIAN
    const assignment = await this.prisma.clinicianChildAssignment.findUnique({
      where: { clinicianId_childId: { clinicianId: caller.id, childId: child.id } },
      select: { id: true },
    });
    if (!assignment) {
      throw this.forbidden();
    }
    return ChildDto.from(child);
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have permission to access this resource.',
    });
  }
}
