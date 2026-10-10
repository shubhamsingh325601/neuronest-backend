import { Test } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { DeleteSlotService } from './delete-slot.service';

describe('DeleteSlotService', () => {
  const prisma = { appointmentSlot: { findUnique: jest.fn(), delete: jest.fn() } };
  let service: DeleteSlotService;

  const asUser = (id: string, role: Role): AuthenticatedUser => ({
    id,
    email: `${id}@example.com`,
    role,
    status: UserStatus.ACTIVE,
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.appointmentSlot.findUnique.mockResolvedValue({
      id: 's-1',
      clinicianId: 'clin-1',
      appointment: null,
    });
    const moduleRef = await Test.createTestingModule({
      providers: [DeleteSlotService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(DeleteSlotService);
  });

  it('removes a free slot owned by the caller', async () => {
    await service.delete('s-1', asUser('clin-1', Role.CLINICIAN));
    expect(prisma.appointmentSlot.delete).toHaveBeenCalledWith({ where: { id: 's-1' } });
  });

  it('lets an admin remove any free slot', async () => {
    await service.delete('s-1', asUser('admin-1', Role.ADMIN));
    expect(prisma.appointmentSlot.delete).toHaveBeenCalled();
  });

  it('404s for an unknown slot', async () => {
    prisma.appointmentSlot.findUnique.mockResolvedValue(null);
    await expect(service.delete('x', asUser('clin-1', Role.CLINICIAN))).rejects.toMatchObject({
      response: { code: 'SLOT_NOT_FOUND' },
    });
  });

  it("403s for another clinician's slot", async () => {
    await expect(service.delete('s-1', asUser('clin-2', Role.CLINICIAN))).rejects.toMatchObject({
      response: { code: 'FORBIDDEN' },
    });
    expect(prisma.appointmentSlot.delete).not.toHaveBeenCalled();
  });

  it('409s once a parent has booked the slot', async () => {
    prisma.appointmentSlot.findUnique.mockResolvedValue({
      id: 's-1',
      clinicianId: 'clin-1',
      appointment: { id: 'a-1' },
    });
    await expect(service.delete('s-1', asUser('clin-1', Role.CLINICIAN))).rejects.toMatchObject({
      response: { code: 'SLOT_BOOKED' },
    });
    expect(prisma.appointmentSlot.delete).not.toHaveBeenCalled();
  });
});
