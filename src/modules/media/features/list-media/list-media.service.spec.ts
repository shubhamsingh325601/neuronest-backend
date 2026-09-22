import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ListMediaService } from './list-media.service';

describe('ListMediaService', () => {
  const prisma = {
    child: { findUnique: jest.fn() },
    clinicianChildAssignment: { findUnique: jest.fn() },
    media: { findMany: jest.fn() },
  };
  let service: ListMediaService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });

  const mediaRow = {
    id: 'media-1',
    childId: 'child-1',
    uploadedById: 'parent-1',
    type: 'PHOTO',
    provider: 'CLOUDINARY',
    storageKey: 'fake/child-1/media-1',
    status: 'UPLOADED',
    mimeType: 'image/jpeg',
    durationSeconds: null,
    sizeBytes: 1024,
    context: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ListMediaService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ListMediaService);
  });

  it('404s when the child does not exist', async () => {
    prisma.child.findUnique.mockResolvedValue(null);
    await expect(service.list('missing', asUser('admin-1', Role.ADMIN), {})).rejects.toThrow(
      NotFoundException,
    );
  });

  it('allows the owning parent and returns a page', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    prisma.media.findMany.mockResolvedValue([mediaRow]);

    const result = await service.list('child-1', asUser('parent-1', Role.PARENT), {});

    expect(result.data).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it('forbids a different parent', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    await expect(service.list('child-1', asUser('parent-2', Role.PARENT), {})).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows an assigned clinician', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue({ id: 'assignment-1' });
    prisma.media.findMany.mockResolvedValue([]);

    const result = await service.list('child-1', asUser('clinician-1', Role.CLINICIAN), {});

    expect(prisma.clinicianChildAssignment.findUnique).toHaveBeenCalledWith({
      where: { clinicianId_childId: { clinicianId: 'clinician-1', childId: 'child-1' } },
      select: { id: true },
    });
    expect(result.data).toEqual([]);
  });

  it('forbids a non-assigned clinician', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    prisma.clinicianChildAssignment.findUnique.mockResolvedValue(null);
    await expect(
      service.list('child-1', asUser('clinician-2', Role.CLINICIAN), {}),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows admin unconditionally', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    prisma.media.findMany.mockResolvedValue([]);
    const result = await service.list('child-1', asUser('admin-1', Role.ADMIN), {});
    expect(result.data).toEqual([]);
  });

  it('derives nextCursor when a page overflows the limit', async () => {
    prisma.child.findUnique.mockResolvedValue({ id: 'child-1', parentId: 'parent-1' });
    prisma.media.findMany.mockResolvedValue([
      { ...mediaRow, id: 'media-1' },
      { ...mediaRow, id: 'media-2' },
    ]);

    const result = await service.list('child-1', asUser('parent-1', Role.PARENT), { limit: 1 });

    expect(result.data).toHaveLength(1);
    expect(result.nextCursor).not.toBeNull();
  });
});
