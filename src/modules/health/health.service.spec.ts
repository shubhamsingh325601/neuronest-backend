import { Test } from '@nestjs/testing';
import { PrismaService } from '@common/prisma/prisma.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const queryRaw = jest.fn();
  let service: HealthService;

  beforeEach(async () => {
    queryRaw.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
      ],
    }).compile();
    service = moduleRef.get(HealthService);
  });

  it('reports ok when the database responds', async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const report = await service.check();
    expect(report.status).toBe('ok');
    expect(report.db).toBe('up');
  });

  it('reports degraded when the database throws', async () => {
    queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    const report = await service.check();
    expect(report.status).toBe('degraded');
    expect(report.db).toBe('down');
  });
});
