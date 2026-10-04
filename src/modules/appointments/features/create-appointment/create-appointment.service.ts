import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { APPOINTMENT_INCLUDE, AppointmentDto } from '@modules/appointments/shared/appointment.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';

/**
 * A parent books a free slot for their own child. `Appointment.slotId` UNIQUE is the
 * database-enforced double-booking guard (`P2002` → `409 SLOT_ALREADY_BOOKED`).
 *
 * `appointment:create:self` reaches ADMIN through the `...PERMISSIONS` spread, so the role
 * check here keeps booking to the child's own PARENT. The one-upcoming-per-child cap is
 * checked inside a transaction that first locks the child row, so two concurrent bookings
 * for the same child serialise (the loser sees the winner's row).
 */
@Injectable()
export class CreateAppointmentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    childId: string,
    caller: AuthenticatedUser,
    dto: CreateAppointmentDto,
    now: Date = new Date(),
  ): Promise<AppointmentDto> {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: { id: true, parentId: true },
    });
    if (!child) {
      throw new NotFoundException({ code: 'CHILD_NOT_FOUND', message: 'No child with that id.' });
    }
    if (caller.role !== Role.PARENT || child.parentId !== caller.id) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this resource.',
      });
    }

    // A slot the child's care team does not own is indistinguishable from a missing one.
    const slot = await this.prisma.appointmentSlot.findFirst({
      where: {
        id: dto.slotId,
        startsAt: { gt: now },
        clinician: { status: UserStatus.ACTIVE, clinicianAssignments: { some: { childId } } },
      },
      select: { id: true },
    });
    if (!slot) {
      throw new NotFoundException({ code: 'SLOT_NOT_FOUND', message: 'No bookable slot with that id.' });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "children" WHERE "id" = ${childId}::uuid FOR UPDATE`;

        const booked = await tx.appointment.findUnique({
          where: { slotId: slot.id },
          select: { id: true },
        });
        if (booked) {
          throw this.alreadyBooked();
        }
        const upcoming = await tx.appointment.findFirst({
          where: { childId, slot: { endsAt: { gt: now } } },
          select: { id: true },
        });
        if (upcoming) {
          throw new ConflictException({
            code: 'APPOINTMENT_ALREADY_UPCOMING',
            message: 'This child already has an upcoming appointment.',
          });
        }

        const row = await tx.appointment.create({
          data: { slotId: slot.id, childId, bookedById: caller.id },
          include: APPOINTMENT_INCLUDE,
        });
        return AppointmentDto.from(row);
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw this.alreadyBooked();
      }
      throw err;
    }
  }

  private alreadyBooked(): ConflictException {
    return new ConflictException({
      code: 'SLOT_ALREADY_BOOKED',
      message: 'That slot has already been booked.',
    });
  }
}
