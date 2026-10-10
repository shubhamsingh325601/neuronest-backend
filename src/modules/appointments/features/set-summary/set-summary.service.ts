import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { APPOINTMENT_INCLUDE, AppointmentDto } from '@modules/appointments/shared/appointment.dto';
import { SetSummaryDto } from './dto/set-summary.dto';

/**
 * After a call starts, its assigned clinician (or an admin) records the summary and the agreed action
 * points the parent then sees in their call history. Idempotent: the same body lands the same state.
 */
@Injectable()
export class SetSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async set(
    id: string,
    caller: AuthenticatedUser,
    dto: SetSummaryDto,
    now: Date = new Date(),
  ): Promise<AppointmentDto> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      select: { id: true, childId: true, slot: { select: { startsAt: true } } },
    });
    if (!appointment) {
      throw new NotFoundException({
        code: 'APPOINTMENT_NOT_FOUND',
        message: 'No appointment with that id.',
      });
    }

    if (caller.role === Role.CLINICIAN) {
      const assignment = await this.prisma.clinicianChildAssignment.findUnique({
        where: { clinicianId_childId: { clinicianId: caller.id, childId: appointment.childId } },
        select: { id: true },
      });
      if (!assignment) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You do not have permission to access this resource.',
        });
      }
    }
    // ADMIN: no check.

    if (appointment.slot.startsAt.getTime() > now.getTime()) {
      throw new ConflictException({
        code: 'APPOINTMENT_NOT_STARTED',
        message: 'A summary can only be written once the call has started.',
      });
    }
    const row = await this.prisma.appointment.update({
      where: { id },
      data: {
        summary: dto.summary.trim(),
        actionPoints: dto.actionPoints.map((point) => point.trim()),
      },
      include: APPOINTMENT_INCLUDE,
    });
    return AppointmentDto.from(row);
  }
}
