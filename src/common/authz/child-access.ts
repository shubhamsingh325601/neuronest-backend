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

/** 403 unless the EXPERT has a live assignment to the child (read-only access, plan 0019 §3 row 3). */
export async function assertExpertAssigned(
  prisma: PrismaService,
  childId: string,
  expertId: string,
): Promise<void> {
  const assignment = await prisma.expertChildAssignment.findUnique({
    where: { expertId_childId: { expertId, childId } },
    select: { id: true },
  });
  if (!assignment) {
    throw forbidden();
  }
}

/**
 * Child-scoped access shared by the parent-app domains (care plan, analyses, chat) (the `media:read` shape, docs/rbac.md §6).
 * - `read`: PARENT owns the child, CLINICIAN or EXPERT is assigned, ADMIN any. Any other role is refused.
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
  } else if (caller.role === Role.EXPERT) {
    await assertExpertAssigned(prisma, childId, caller.id);
  } else if (caller.role !== Role.ADMIN) {
    throw forbidden();
  }
  return child;
}
