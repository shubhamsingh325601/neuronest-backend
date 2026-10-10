import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';

/**
 * A parent cancels their own child's booking until the call starts. The appointment row is deleted,
 * which frees the slot for anyone assigned to book it again. `appointment:cancel:self` reaches ADMIN
 * through the `...PERMISSIONS` spread, so the role check keeps cancelling to the child's own PARENT.
 */
@Injectable()
export class CancelAppointmentService {
  constructor(private readonly prisma: PrismaService) {}

  async cancel(id: string, caller: AuthenticatedUser, now: Date = new Date()): Promise<void> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      select: {
        id: true,
        child: { select: { parentId: true } },
        slot: { select: { startsAt: true } },
      },
    });
    if (!appointment) {
      throw new NotFoundException({
        code: 'APPOINTMENT_NOT_FOUND',
        message: 'No appointment with that id.',
      });
    }
    if (caller.role !== Role.PARENT || appointment.child.parentId !== caller.id) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this resource.',
      });
    }
    if (appointment.slot.startsAt.getTime() <= now.getTime()) {
      throw new ConflictException({
        code: 'APPOINTMENT_STARTED',
        message: 'This call has already started and can no longer be cancelled.',
      });
    }
    await this.prisma.appointment.deleteMany({ where: { id } });
  }
}
