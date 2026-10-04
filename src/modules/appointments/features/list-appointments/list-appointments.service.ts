import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { decodeCursor, toCursorPage } from '@common/pagination/cursor.util';
import { DEFAULT_PAGE_LIMIT } from '@common/pagination/cursor-pagination.query.dto';
import { PrismaService } from '@common/prisma/prisma.service';
import {
  APPOINTMENT_INCLUDE,
  AppointmentDto,
  ListAppointmentsQueryDto,
  ListAppointmentsResponseDto,
  whenClause,
} from '@modules/appointments/shared/appointment.dto';

/**
 * Cross-child appointment list, a query filter (the `GET /v1/children` shape):
 * CLINICIAN → appointments on their own slots; PARENT → their own child's; ADMIN → all.
 */
@Injectable()
export class ListAppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    caller: AuthenticatedUser,
    query: ListAppointmentsQueryDto,
    now: Date = new Date(),
  ): Promise<ListAppointmentsResponseDto> {
    const scope: Prisma.AppointmentWhereInput =
      caller.role === Role.CLINICIAN
        ? { slot: { clinicianId: caller.id } }
        : caller.role === Role.PARENT
          ? { child: { parentId: caller.id } }
          : {};
    const { where, orderBy } = whenClause(query.when, now);

    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const rows = await this.prisma.appointment.findMany({
      where: { AND: [scope, where] },
      include: APPOINTMENT_INCLUDE,
      orderBy,
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });

    const page = toCursorPage(rows, limit, (row) => row.id);
    return { data: page.data.map(AppointmentDto.from), nextCursor: page.nextCursor };
  }
}
