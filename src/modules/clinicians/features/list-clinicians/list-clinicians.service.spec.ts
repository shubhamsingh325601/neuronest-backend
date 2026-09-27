import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { encodeCursor } from '@common/pagination/cursor.util';
import { PrismaService } from '@common/prisma/prisma.service';
import { ListCliniciansService } from './list-clinicians.service';

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';

const row = (id: string) => ({
  id,
  name: 'Dr. Sam Okafor',
  email: 'sam@clinic.example',
  role: Role.CLINICIAN,
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01T00:00:00Z'),
});

describe('ListCliniciansService', () => {
  const prisma = { user: { findMany: jest.fn() } };
  let service: ListCliniciansService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ListCliniciansService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ListCliniciansService);
  });

  it('filters to role CLINICIAN, defaults limit to 20, no cursor', async () => {
    prisma.user.findMany.mockResolvedValue([row(UUID_A)]);

    const res = await service.list({});

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: Role.CLINICIAN },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 21,
    });
    expect(res.data).toHaveLength(1);
    expect(res.nextCursor).toBeNull();
  });

  it('over-fetches by one and returns a nextCursor when there is another page', async () => {
    prisma.user.findMany.mockResolvedValue([row(UUID_A), row(UUID_B)]);

    const res = await service.list({ limit: 1 });

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
    expect(res.data.map((r) => r.id)).toEqual([UUID_A]);
    expect(res.nextCursor).toBe(encodeCursor(UUID_A));
  });

  it('decodes the cursor and skips the anchor row', async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await service.list({ cursor: encodeCursor(UUID_A) });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: UUID_A }, skip: 1 }),
    );
  });
});
