import { Test } from '@nestjs/testing';
import { Prisma, Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { CreateSlotService } from './create-slot.service';

describe('CreateSlotService', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    appointmentSlot: { findFirst: jest.fn(), create: jest.fn() },
  };
  let service: CreateSlotService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });
  const clinician = asUser('clin-1', Role.CLINICIAN);
  const admin = asUser('admin-1', Role.ADMIN);

  const HOUR = 3_600_000;
  const at = (hoursFromNow: number): string =>
    new Date(Date.now() + hoursFromNow * HOUR).toISOString();
  const dto = (overrides: Record<string, unknown> = {}) => ({
    startsAt: at(24),
    endsAt: at(24.5),
    ...overrides,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.user.findUnique.mockResolvedValue({
      id: 'clin-1',
      name: 'Dr Clin',
      role: Role.CLINICIAN,
      status: UserStatus.ACTIVE,
    });
    prisma.appointmentSlot.findFirst.mockResolvedValue(null);
    prisma.appointmentSlot.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'slot-1', createdAt: new Date(), ...data }),
    );
    const moduleRef = await Test.createTestingModule({
      providers: [CreateSlotService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(CreateSlotService);
  });

  it('a clinician publishes their own slot; the response embeds clinician id + name', async () => {
    const out = await service.create(clinician, dto());
    expect(out.clinician).toEqual({ id: 'clin-1', name: 'Dr Clin' });
    expect(prisma.appointmentSlot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ clinicianId: 'clin-1', createdById: 'clin-1' }),
    });
  });

  it('an admin publishes for the named clinician and is recorded as creator', async () => {
    await service.create(admin, dto({ clinicianId: 'clin-1' }));
    expect(prisma.appointmentSlot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ clinicianId: 'clin-1', createdById: 'admin-1' }),
    });
  });

  it('400s CLINICIAN_ID_REQUIRED when an admin omits clinicianId', async () => {
    await expect(service.create(admin, dto())).rejects.toMatchObject({
      response: { code: 'CLINICIAN_ID_REQUIRED' },
    });
  });

  it('403s when a clinician names another clinician', async () => {
    await expect(service.create(clinician, dto({ clinicianId: 'clin-2' }))).rejects.toMatchObject({
      response: { code: 'FORBIDDEN' },
    });
    expect(prisma.appointmentSlot.create).not.toHaveBeenCalled();
  });

  it('400s INVALID_SLOT_RANGE when endsAt is not after startsAt', async () => {
    await expect(
      service.create(clinician, dto({ startsAt: at(24), endsAt: at(24) })),
    ).rejects.toMatchObject({ response: { code: 'INVALID_SLOT_RANGE' } });
  });

  it('400s SLOT_TOO_LONG past 2 hours, accepts exactly 2 hours', async () => {
    await expect(
      service.create(clinician, dto({ startsAt: at(24), endsAt: at(26.01) })),
    ).rejects.toMatchObject({ response: { code: 'SLOT_TOO_LONG' } });
    const start = new Date(Date.now() + 24 * HOUR);
    await expect(
      service.create(clinician, {
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 2 * HOUR).toISOString(),
      }),
    ).resolves.toBeDefined();
  });

  it('400s SLOT_IN_PAST for a start that is not in the future', async () => {
    await expect(
      service.create(clinician, dto({ startsAt: at(-2), endsAt: at(-1.5) })),
    ).rejects.toMatchObject({ response: { code: 'SLOT_IN_PAST' } });
  });

  it('404s CLINICIAN_NOT_FOUND for an unknown id or a non-clinician', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.create(admin, dto({ clinicianId: 'nope' }))).rejects.toMatchObject({
      response: { code: 'CLINICIAN_NOT_FOUND' },
    });
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'p-1',
      name: 'P',
      role: Role.PARENT,
      status: UserStatus.ACTIVE,
    });
    await expect(service.create(admin, dto({ clinicianId: 'p-1' }))).rejects.toMatchObject({
      response: { code: 'CLINICIAN_NOT_FOUND' },
    });
  });

  it.each([UserStatus.INVITED, UserStatus.SUSPENDED, UserStatus.DEACTIVATED])(
    '409s CLINICIAN_NOT_ACTIVE when the clinician is %s',
    async (status) => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'clin-1',
        name: 'Dr Clin',
        role: Role.CLINICIAN,
        status,
      });
      await expect(service.create(admin, dto({ clinicianId: 'clin-1' }))).rejects.toMatchObject({
        response: { code: 'CLINICIAN_NOT_ACTIVE' },
      });
    },
  );

  it('409s SLOT_OVERLAP when an existing slot overlaps the window', async () => {
    prisma.appointmentSlot.findFirst.mockResolvedValue({ id: 'other' });
    await expect(service.create(clinician, dto())).rejects.toMatchObject({
      response: { code: 'SLOT_OVERLAP' },
    });
    const where = prisma.appointmentSlot.findFirst.mock.calls[0][0].where;
    expect(where.clinicianId).toBe('clin-1');
    expect(where.startsAt).toHaveProperty('lt');
    expect(where.endsAt).toHaveProperty('gt');
    expect(prisma.appointmentSlot.create).not.toHaveBeenCalled();
  });

  it('maps the unique-index race (P2002) to 409 SLOT_OVERLAP', async () => {
    prisma.appointmentSlot.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(service.create(clinician, dto())).rejects.toMatchObject({
      response: { code: 'SLOT_OVERLAP' },
    });
  });
});
