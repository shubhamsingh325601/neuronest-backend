import { Test } from '@nestjs/testing';
import { JobStatus } from '@prisma/client';
import { encodeCursor } from '@common/pagination/cursor.util';
import { PrismaService } from '@common/prisma/prisma.service';
import { ListJobsService } from './list-jobs.service';

const row = (id: string) => ({
  id,
  type: 't',
  status: JobStatus.DEAD,
  priority: 0,
  payload: {},
  runAt: new Date(),
  attempts: 5,
  maxAttempts: 5,
  lastError: null,
  lockedAt: null,
  lockedBy: null,
  dedupeKey: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
});

describe('ListJobsService', () => {
  const prisma = { job: { findMany: jest.fn() } };
  let service: ListJobsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ListJobsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ListJobsService);
  });

  it('applies status/type filters, newest first, and fetches limit + 1', async () => {
    prisma.job.findMany.mockResolvedValue([]);
    await service.list({ status: JobStatus.DEAD, type: 't', limit: 2 });
    expect(prisma.job.findMany).toHaveBeenCalledWith({
      where: { status: JobStatus.DEAD, type: 't' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
    });
  });

  it('returns a nextCursor when more rows remain', async () => {
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    const c = '33333333-3333-4333-8333-333333333333';
    prisma.job.findMany.mockResolvedValue([row(a), row(b), row(c)]);
    const page = await service.list({ limit: 2 });
    expect(page.data).toHaveLength(2);
    expect(page.nextCursor).toBe(encodeCursor(b));
  });

  it('passes a decoded cursor through', async () => {
    const a = '11111111-1111-4111-8111-111111111111';
    prisma.job.findMany.mockResolvedValue([]);
    await service.list({ cursor: encodeCursor(a) });
    expect(prisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: a }, skip: 1 }),
    );
  });
});
