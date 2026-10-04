import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { decodeCursor, toCursorPage } from '@common/pagination/cursor.util';
import { DEFAULT_PAGE_LIMIT } from '@common/pagination/cursor-pagination.query.dto';
import { PrismaService } from '@common/prisma/prisma.service';
import { assertChildAppointmentReadAccess } from '@modules/appointments/shared/appointment-access';
import {
  APPOINTMENT_INCLUDE,
  AppointmentDto,
  ListAppointmentsQueryDto,
  ListAppointmentsResponseDto,
  whenClause,
} from '@modules/appointments/shared/appointment.dto';

/** A child's appointments — parent (own), assigned clinician, or admin (`child:read` shape). */
@Injectable()
export class ListChildAppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    childId: string,
    caller: AuthenticatedUser,
    query: ListAppointmentsQueryDto,
    now: Date = new Date(),
  ): Promise<ListAppointmentsResponseDto> {
    await assertChildAppointmentReadAccess(this.prisma, childId, caller);

    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const { where, orderBy } = whenClause(query.when, now);
    const rows = await this.prisma.appointment.findMany({
      where: { ...where, childId },
      include: APPOINTMENT_INCLUDE,
      orderBy,
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });

    const page = toCursorPage(rows, limit, (row) => row.id);
    return { data: page.data.map(AppointmentDto.from), nextCursor: page.nextCursor };
  }
}
