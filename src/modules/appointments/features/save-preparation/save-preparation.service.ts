import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { APPOINTMENT_INCLUDE, AppointmentDto } from '@modules/appointments/shared/appointment.dto';
import { SavePreparationDto } from './dto/save-preparation.dto';

/**
 * The parent records what they want to cover and which preparation steps they have done, until the call
 * ends. Idempotent: the same body lands the same state. `appointment:prepare:self` reaches ADMIN through
 * the `...PERMISSIONS` spread, so the role check keeps this to the child's own PARENT.
 */
@Injectable()
export class SavePreparationService {
  constructor(private readonly prisma: PrismaService) {}

  async save(
    id: string,
    caller: AuthenticatedUser,
    dto: SavePreparationDto,
    now: Date = new Date(),
  ): Promise<AppointmentDto> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      select: { id: true, child: { select: { parentId: true } }, slot: { select: { endsAt: true } } },
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
    if (appointment.slot.endsAt.getTime() <= now.getTime()) {
      throw new ConflictException({
        code: 'APPOINTMENT_ENDED',
        message: 'This call has already ended.',
      });
    }
    const row = await this.prisma.appointment.update({
      where: { id },
      data: {
        prepTopicIds: [...new Set(dto.topicIds)],
        prepChecklistIds: [...new Set(dto.checklistIds)],
      },
      include: APPOINTMENT_INCLUDE,
    });
    return AppointmentDto.from(row);
  }
}