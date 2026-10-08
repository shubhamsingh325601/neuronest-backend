import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { UpdateChildService } from './update-child.service';

describe('UpdateChildService', () => {
  const child = { findUnique: jest.fn(), update: jest.fn() };
  let service: UpdateChildService;
  const parent = { id: 'p1', role: Role.PARENT } as never;

  beforeEach(async () => {
    child.findUnique.mockReset();
    child.update.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [UpdateChildService, { provide: PrismaService, useValue: { child } }],
    }).compile();
    service = moduleRef.get(UpdateChildService);
  });

  it('404s for an unknown child', async () => {
    child.findUnique.mockResolvedValue(null);
    await expect(service.update('c1', parent, { name: 'A' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("403s when the caller is not the child's parent", async () => {
    child.findUnique.mockResolvedValue({ id: 'c1', parentId: 'someone-else' });
    await expect(service.update('c1', parent, { name: 'A' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    child.findUnique.mockResolvedValue({ id: 'c1', parentId: 'p1' });
    await expect(
      service.update('c1', { id: 'p1', role: Role.ADMIN } as never, { name: 'A' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('400s on an empty patch', async () => {
    child.findUnique.mockResolvedValue({ id: 'c1', parentId: 'p1' });
    await expect(service.update('c1', parent, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('trims values and turns empty strings into null', async () => {
    child.findUnique.mockResolvedValue({ id: 'c1', parentId: 'p1' });
    child.update.mockResolvedValue({ id: 'c1' });
    await service.update('c1', parent, { name: ' Alex ', accommodations: '  ', gender: ' Male' });
    expect(child.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { name: 'Alex', accommodations: null, gender: 'Male' },
    });
  });
});
