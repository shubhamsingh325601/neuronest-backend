import { Test } from '@nestjs/testing';
import { encodeCursor } from '@common/pagination/cursor.util';
import { PrismaService } from '@common/prisma/prisma.service';
import { ListApplicationsService } from './list-applications.service';

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';

const row = (id: string) => ({
  id,
  name: 'Dr. Sam',
  email: 'sam@clinic.example',
  context: 'ctx',
  status: 'PENDING',
  reviewNote: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
});

describe('ListApplicationsService', () => {
  const prisma = { clinicianApplication: { findMany: jest.fn() } };
  let service: ListApplicationsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ListApplicationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(ListApplicationsService);
  });

  it('defaults limit to 20, no status filter, no cursor', async () => {
    prisma.clinicianApplication.findMany.mockResolvedValue([row(UUID_A)]);

    const res = await service.list({});

    expect(prisma.clinicianApplication.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 21,
    });
    expect(res.data).toHaveLength(1);
    expect(res.nextCursor).toBeNull();
  });

  it('passes the status filter through', async () => {
    prisma.clinicianApplication.findMany.mockResolvedValue([]);

    await service.list({ status: 'APPROVED' as never });

    expect(prisma.clinicianApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'APPROVED' } }),
    );
  });

  it('over-fetches by one and returns a nextCursor when there is another page', async () => {
    prisma.clinicianApplication.findMany.mockResolvedValue([row(UUID_A), row(UUID_B)]);

    const res = await service.list({ limit: 1 });

    expect(prisma.clinicianApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2 }),
    );
    expect(res.data.map((r) => r.id)).toEqual([UUID_A]);
    expect(res.nextCursor).toBe(encodeCursor(UUID_A));
  });

  it('decodes the cursor and skips the anchor row', async () => {
    prisma.clinicianApplication.findMany.mockResolvedValue([]);

    await service.list({ cursor: encodeCursor(UUID_A) });

    expect(prisma.clinicianApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: UUID_A }, skip: 1 }),
    );
  });
});
