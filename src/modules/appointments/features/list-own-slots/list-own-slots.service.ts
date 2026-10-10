import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { decodeCursor, toCursorPage } from '@common/pagination/cursor.util';
import { DEFAULT_PAGE_LIMIT } from '@common/pagination/cursor-pagination.query.dto';
import { PrismaService } from '@common/prisma/prisma.service';
import { OwnSlotDto } from '@modules/appointments/shared/own-slot.dto';
import { ListOwnSlotsQueryDto, ListOwnSlotsResponseDto } from './dto/list-own-slots.dto';

/**
 * The availability a clinician has published and not yet used up: slots that have not ended,
 * booked or free, soonest first. A CLINICIAN only ever sees their own; an ADMIN sees every
 * clinician's, or one clinician's with `clinicianId`.
 */
@Injectable()
export class ListOwnSlotsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    caller: AuthenticatedUser,
    query: ListOwnSlotsQueryDto,
  ): Promise<ListOwnSlotsResponseDto> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const owner: Prisma.AppointmentSlotWhereInput =
      caller.role === Role.CLINICIAN
        ? { clinicianId: caller.id }
        : query.clinicianId
          ? { clinicianId: query.clinicianId }
          : {};

    const rows = await this.prisma.appointmentSlot.findMany({
      where: { ...owner, endsAt: { gt: new Date() } },
      include: { appointment: { select: { id: true } } },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });

    const page = toCursorPage(rows, limit, (row) => row.id);
    return { data: page.data.map(OwnSlotDto.from), nextCursor: page.nextCursor };
  }
}
