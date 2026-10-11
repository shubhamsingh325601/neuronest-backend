import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import type { PrismaService } from '@common/prisma/prisma.service';
import type { AuthenticatedUser } from './jwt-payload.type';
import { assertChildAccess } from './child-access';

describe('assertChildAccess', () => {
  const child = { id: 'child-1', parentId: 'parent-1' };
  const prisma = {
    child: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
    expertChildAssignment: { findUnique: jest.fn() },
  };
  const db = prisma as unknown as PrismaService;
  const as = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.child.findUnique.mockResolvedValue(child);
  });

  it('404s for an unknown child', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(assertChildAccess(db, 'x', as('a', Role.ADMIN), 'read')).rejects.toThrow(
      NotFoundException,
    );
  });

  describe('read', () => {
    it('lets the owning parent in and keeps other parents out', async () => {
      await expect(assertChildAccess(db, 'child-1', as('parent-1', Role.PARENT), 'read')).resolves.toEqual(child);
      await expect(assertChildAccess(db, 'child-1', as('parent-2', Role.PARENT), 'read')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lets an assigned clinician in and refuses an unassigned one', async () => {
      prisma.clinicianChildAssignment.findUnique.mockResolvedValueOnce({ id: 'a' });
      await expect(assertChildAccess(db, 'child-1', as('cl-1', Role.CLINICIAN), 'read')).resolves.toEqual(child);
      prisma.clinicianChildAssignment.findUnique.mockResolvedValueOnce(null);
      await expect(assertChildAccess(db, 'child-1', as('cl-2', Role.CLINICIAN), 'read')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lets an assigned expert in and refuses an unassigned one', async () => {
      prisma.expertChildAssignment.findUnique.mockResolvedValueOnce({ id: 'a' });
      await expect(assertChildAccess(db, 'child-1', as('ex-1', Role.EXPERT), 'read')).resolves.toEqual(child);
      expect(prisma.expertChildAssignment.findUnique).toHaveBeenCalledWith({
        where: { expertId_childId: { expertId: 'ex-1', childId: 'child-1' } },
        select: { id: true },
      });
      prisma.expertChildAssignment.findUnique.mockResolvedValueOnce(null);
      await expect(assertChildAccess(db, 'child-1', as('ex-2', Role.EXPERT), 'read')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lets ADMIN in without any assignment lookup', async () => {
      await expect(assertChildAccess(db, 'child-1', as('ad-1', Role.ADMIN), 'read')).resolves.toEqual(child);
      expect(prisma.clinicianChildAssignment.findUnique).not.toHaveBeenCalled();
      expect(prisma.expertChildAssignment.findUnique).not.toHaveBeenCalled();
    });

    it('refuses a role it does not know (default deny)', async () => {
      const stranger = as('x-1', 'SOMETHING_NEW' as Role);
      await expect(assertChildAccess(db, 'child-1', stranger, 'read')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('parent-write', () => {
    it('allows only the owning parent', async () => {
      await expect(assertChildAccess(db, 'child-1', as('parent-1', Role.PARENT), 'parent-write')).resolves.toEqual(child);
      for (const caller of [
        as('parent-2', Role.PARENT),
        as('cl-1', Role.CLINICIAN),
        as('ex-1', Role.EXPERT),
        as('ad-1', Role.ADMIN),
      ]) {
        await expect(assertChildAccess(db, 'child-1', caller, 'parent-write')).rejects.toThrow(
          ForbiddenException,
        );
      }
    });
  });
});
