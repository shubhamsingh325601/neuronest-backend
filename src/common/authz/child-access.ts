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
 * Child-scoped access shared by the parent-app domains (care plan, analyses, chat, escalations) (the `media:read` shape, docs/rbac.md §6).
 * - `read`: PARENT owns the child, CLINICIAN is assigned, ADMIN any.
 * - `parent-write`: only the child's own PARENT (admin and clinicians are read-only here).
 */
export async function assertChildAccess(
  prisma: PrismaService,
  childId: string,
  caller: AuthenticatedUser,
  mode: 'read' | 'parent-write',
): Promise<{ id: string; parentId: string }> {
  const child = await prisma.child.findUnique({
    where: { id: childId },
    select: { id: true, parentId: true },
  });
  if (!child) {
    throw new NotFoundException({ code: 'CHILD_NOT_FOUND', message: 'No child with that id.' });
  }

  if (mode === 'parent-write') {
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
  return child;
}
