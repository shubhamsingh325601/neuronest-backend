import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import type { PrismaService } from '@common/prisma/prisma.service';

function forbidden(): ForbiddenException {
  return new ForbiddenException({
    code: 'FORBIDDEN',
    message: 'You do not have permission to access this resource.',
  });
}

/**
 * Shared scoping for `progress:*` routes (the `media:read` shape, docs/rbac.md §6).
 * - `mode: 'read'`: PARENT must own the child, CLINICIAN must be assigned, ADMIN any.
 * - `mode: 'write'`: only the child's own PARENT. `progress:write:self` reaches ADMIN via
 *   the `...PERMISSIONS` spread, so the role check here is what keeps admin read-only.
 */
export async function assertChildProgressAccess(
  prisma: PrismaService,
  childId: string,
  caller: AuthenticatedUser,
  mode: 'read' | 'write',
): Promise<{ id: string; parentId: string }> {
  const child = await prisma.child.findUnique({
    where: { id: childId },
    select: { id: true, parentId: true },
  });
  if (!child) {
    throw new NotFoundException({ code: 'CHILD_NOT_FOUND', message: 'No child with that id.' });
  }

  if (mode === 'write') {
    if (caller.role !== Role.PARENT || child.parentId !== caller.id) {
      throw forbidden();
    }
    return child;
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
  }
  // ADMIN: no check.
  return child;
}
