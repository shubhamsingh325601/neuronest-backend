import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { MAX_SLOT_DURATION_MS } from '@modules/appointments/shared/appointment.constants';
import { AppointmentSlotDto } from '@modules/appointments/shared/appointment-slot.dto';
import { CreateSlotDto } from './dto/create-slot.dto';

/**
 * A clinician (own slots only) or admin (`clinicianId` required) publishes availability.
 * Overlap is a service-level check plus the `@@unique([clinicianId, startsAt])` backstop;
 * a race between two publishers on non-identical starts is an accepted residual
 * (plan 0014 §3 row 3).
 */
@Injectable()
export class CreateSlotService {
  constructor(private readonly prisma: PrismaService) {}

  async create(caller: AuthenticatedUser, dto: CreateSlotDto): Promise<AppointmentSlotDto> {
    const clinicianId = this.resolveClinicianId(caller, dto);

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new BadRequestException({
        code: 'INVALID_SLOT_RANGE',
        message: 'endsAt must be after startsAt.',
      });
    }
    if (endsAt.getTime() - startsAt.getTime() > MAX_SLOT_DURATION_MS) {
      throw new BadRequestException({
        code: 'SLOT_TOO_LONG',
        message: 'A slot may last at most 2 hours.',
      });
    }
    if (startsAt.getTime() <= Date.now()) {
      throw new BadRequestException({
        code: 'SLOT_IN_PAST',
        message: 'startsAt must be in the future.',
      });
    }

    const clinician = await this.prisma.user.findUnique({
      where: { id: clinicianId },
      select: { id: true, name: true, role: true, status: true },
    });
    if (!clinician || clinician.role !== Role.CLINICIAN) {
      throw new NotFoundException({
        code: 'CLINICIAN_NOT_FOUND',
        message: 'No clinician with that id.',
      });
    }
    if (clinician.status !== UserStatus.ACTIVE) {
      throw new ConflictException({
        code: 'CLINICIAN_NOT_ACTIVE',
        message: 'This clinician is not active and cannot publish availability.',
      });
    }

    const overlapping = await this.prisma.appointmentSlot.findFirst({
      where: { clinicianId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
      select: { id: true },
    });
    if (overlapping) {
      throw this.overlap();
    }

    try {
      const slot = await this.prisma.appointmentSlot.create({
        data: { clinicianId, startsAt, endsAt, createdById: caller.id },
      });
      return AppointmentSlotDto.from({ ...slot, clinician });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw this.overlap();
      }
      throw err;
    }
  }

  private resolveClinicianId(caller: AuthenticatedUser, dto: CreateSlotDto): string {
    if (caller.role === Role.ADMIN) {
      if (!dto.clinicianId) {
        throw new BadRequestException({
          code: 'CLINICIAN_ID_REQUIRED',
          message: 'clinicianId is required when an admin publishes a slot.',
        });
      }
      return dto.clinicianId;
    }
    if (dto.clinicianId && dto.clinicianId !== caller.id) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You can only publish slots for yourself.',
      });
    }
    return caller.id;
  }

  private overlap(): ConflictException {
    return new ConflictException({
      code: 'SLOT_OVERLAP',
      message: 'This clinician already has a slot overlapping that time.',
    });
  }
}
