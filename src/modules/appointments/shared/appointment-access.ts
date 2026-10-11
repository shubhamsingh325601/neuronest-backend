import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { assertExpertAssigned } from '@common/authz/child-access';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import type { PrismaService } from '@common/prisma/prisma.service';

function forbidden(): ForbiddenException {
  return new ForbiddenException({
    code: 'FORBIDDEN',
    message: 'You do not have permission to access this resource.',
  });
}

/**
 * Shared scoping for the child-nested `appointment-slot:read` / `appointment:read` routes
 * (the `child:read` shape, docs/rbac.md §6): PARENT must own the child, CLINICIAN must be
 * assigned, EXPERT must be assigned, ADMIN any. Any other role is refused.
 */
export async function assertChildAppointmentReadAccess(
  prisma: PrismaService,
  childId: string,
  caller: AuthenticatedUser,
): Promise<{ id: string; parentId: string }> {
  const child = await prisma.child.findUnique({
    where: { id: childId },
    select: { id: true, parentId: true },
  });
  if (!child) {
    throw new NotFoundException({ code: 'CHILD_NOT_FOUND', message: 'No child with that id.' });
  }

  if (caller.role === Role.PARENT) {
    if (child.parentId !== caller.id) {
      throw forbidden();
    }
  } else if (caller.role === Role.CLINICIAN) {
    const assignment = await prisma.clinicianChildAssignment.findUnique({
      where: { clinicianId_childId: { clinicianId: caller.id, childId } },
      select: { id: true },
    });
    if (!assignment) {
      throw forbidden();
    }
  } else if (caller.role === Role.EXPERT) {
    await assertExpertAssigned(prisma, childId, caller.id);
  } else if (caller.role !== Role.ADMIN) {
    throw forbidden();
  }
  return child;
}
