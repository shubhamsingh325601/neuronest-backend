import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { UpsertProgressService } from './upsert-progress.service';

describe('UpsertProgressService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    plan: { findFirst: jest.fn() },
    progressEntry: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  let service: UpsertProgressService;
  const now = new Date('2026-10-04T12:00:00Z');

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });
  const parent = asUser('parent-1', Role.PARENT);
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'e-1',
    childId: 'child-1',
    planId: null,
    entryDate: new Date('2026-10-03T00:00:00Z'),
    mood: 4,
    behaviour: null,
    sleepMinutes: null,
    note: null,
    createdById: 'parent-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    prisma.progressEntry.findUnique.mockResolvedValue(null);
    prisma.plan.findFirst.mockResolvedValue(null);
    prisma.progressEntry.create.mockImplementation(({ data }) => Promise.resolve(row(data)));
    prisma.progressEntry.update.mockImplementation(({ data }) => Promise.resolve(row(data)));
    const moduleRef = await Test.createTestingModule({
      providers: [UpsertProgressService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(UpsertProgressService);
  });

  it('404s for an unknown child', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(service.upsert('x', '2026-10-03', parent, { mood: 3 }, now)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('403s for another parent, a clinician and an admin (write is own-parent only)', async () => {
    for (const caller of [
      asUser('other', Role.PARENT),
      asUser('cl-1', Role.CLINICIAN),
      asUser('admin-1', Role.ADMIN),
    ]) {
      await expect(service.upsert('child-1', '2026-10-03', caller, { mood: 3 }, now)).rejects.toThrow(
        ForbiddenException,
      );
    }
  });

  it('400s on an empty body', async () => {
    await expect(service.upsert('child-1', '2026-10-03', parent, {}, now)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('400s for a date older than the 30-day window, accepts exactly 30 days back', async () => {
    await expect(service.upsert('child-1', '2026-09-03', parent, { mood: 3 }, now)).rejects.toThrow(
      BadRequestException,
    );
    const result = await service.upsert('child-1', '2026-09-04', parent, { mood: 3 }, now);
    expect(result.created).toBe(true);
  });

  it('creates with no plan: planId null (a brand-new child can log)', async () => {
    const result = await service.upsert('child-1', '2026-10-03', parent, { mood: 4 }, now);
    expect(result.created).toBe(true);
    expect(prisma.progressEntry.create.mock.calls[0][0].data).toMatchObject({
      childId: 'child-1',
      planId: null,
      createdById: 'parent-1',
      mood: 4,
      behaviour: null,
    });
  });

  it('stamps the ACTIVE plan on create', async () => {
    prisma.plan.findFirst.mockResolvedValue({ id: 'plan-1' });
    await service.upsert('child-1', '2026-10-03', parent, { mood: 4 }, now);
    expect(prisma.progressEntry.create.mock.calls[0][0].data.planId).toBe('plan-1');
  });

  it('replaces an existing entry without touching planId or looking up the plan', async () => {
    prisma.progressEntry.findUnique.mockResolvedValue(row({ planId: 'plan-old' }));
    const result = await service.upsert('child-1', '2026-10-03', parent, { sleepMinutes: 480 }, now);
    expect(result.created).toBe(false);
    expect(prisma.plan.findFirst).not.toHaveBeenCalled();
    const data = prisma.progressEntry.update.mock.calls[0][0].data;
    expect(data).toEqual({ mood: null, behaviour: null, sleepMinutes: 480, note: null });
  });

  it('treats a unique-violation race on create as an update', async () => {
    prisma.progressEntry.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    const result = await service.upsert('child-1', '2026-10-03', parent, { mood: 2 }, now);
    expect(result.created).toBe(false);
    expect(prisma.progressEntry.update).toHaveBeenCalled();
  });
});
