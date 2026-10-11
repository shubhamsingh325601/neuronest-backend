import { ForbiddenException, Injectable } from '@nestjs/common';
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
 * CLINICIAN → appointments on their own slots; PARENT → their own child's; EXPERT → children they are
 * assigned to; ADMIN → all. Any other role is refused.
 */
@Injectable()
export class ListAppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    caller: AuthenticatedUser,
    query: ListAppointmentsQueryDto,
    now: Date = new Date(),
  ): Promise<ListAppointmentsResponseDto> {
    let scope: Prisma.AppointmentWhereInput;
    switch (caller.role) {
      case Role.CLINICIAN:
        scope = { slot: { clinicianId: caller.id } };
        break;
      case Role.PARENT:
        scope = { child: { parentId: caller.id } };
        break;
      case Role.EXPERT:
        scope = { child: { expertAssignments: { some: { expertId: caller.id } } } };
        break;
      case Role.ADMIN:
        scope = {};
        break;
      default:
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You do not have permission to access this resource.',
        });
    }
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
