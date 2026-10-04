import { Injectable } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { decodeCursor, toCursorPage } from '@common/pagination/cursor.util';
import { DEFAULT_PAGE_LIMIT } from '@common/pagination/cursor-pagination.query.dto';
import { PrismaService } from '@common/prisma/prisma.service';
import { assertChildAppointmentReadAccess } from '@modules/appointments/shared/appointment-access';
import { AppointmentSlotDto } from '@modules/appointments/shared/appointment-slot.dto';
import { ListSlotsQueryDto, ListSlotsResponseDto } from './dto/list-slots.dto';

/**
 * Free future slots a child's family can book. After the `child:read`-shaped access check
 * this is a query filter (plan 0014 §3 row 6): slots of clinicians assigned to the child,
 * unbooked, in the future, soonest first. Slots of clinicians who are no longer ACTIVE are
 * left out so a suspended clinician cannot be booked.
 */
@Injectable()
export class ListSlotsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    childId: string,
    caller: AuthenticatedUser,
    query: ListSlotsQueryDto,
  ): Promise<ListSlotsResponseDto> {
    await assertChildAppointmentReadAccess(this.prisma, childId, caller);

    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const rows = await this.prisma.appointmentSlot.findMany({
      where: {
        startsAt: { gt: new Date() },
        appointment: null,
        clinician: {
          status: UserStatus.ACTIVE,
          clinicianAssignments: { some: { childId } },
        },
      },
      include: { clinician: { select: { id: true, name: true } } },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });

    const page = toCursorPage(rows, limit, (row) => row.id);
    return { data: page.data.map(AppointmentSlotDto.from), nextCursor: page.nextCursor };
  }
}
