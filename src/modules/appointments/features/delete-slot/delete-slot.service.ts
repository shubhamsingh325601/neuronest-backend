import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';

/** The owning clinician (or an admin) withdraws a slot that nobody has booked. */
@Injectable()
export class DeleteSlotService {
  constructor(private readonly prisma: PrismaService) {}

  async delete(id: string, caller: AuthenticatedUser): Promise<void> {
    const slot = await this.prisma.appointmentSlot.findUnique({
      where: { id },
      include: { appointment: { select: { id: true } } },
    });
    if (!slot) {
      throw new NotFoundException({ code: 'SLOT_NOT_FOUND', message: 'No such slot.' });
    }
    if (caller.role !== Role.ADMIN && slot.clinicianId !== caller.id) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only remove your own slots.',
      });
    }
    if (slot.appointment) {
      throw new ConflictException({
        code: 'SLOT_BOOKED',
        message: 'A parent has booked this slot, so it cannot be removed.',
      });
    }
    await this.prisma.appointmentSlot.delete({ where: { id } });
  }
}
