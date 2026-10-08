import { Injectable } from '@nestjs/common';
import { EscalationStatus, Prisma, Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { DEFAULT_PAGE_LIMIT } from '@common/pagination/cursor-pagination.query.dto';
import { decodeCursor, toCursorPage } from '@common/pagination/cursor.util';
import { PrismaService } from '@common/prisma/prisma.service';
import { assignedClinicianName } from '@modules/escalations/shared/assigned-clinician';
import { EscalationDto, EscalationPageDto } from '@modules/escalations/shared/escalation.dto';
import { ListEscalationsQueryDto } from './list-escalations.dto';

/** Query-filter scoping: a clinician only sees requests for the children assigned to them. */
@Injectable()
export class ListEscalationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    caller: AuthenticatedUser,
    query: ListEscalationsQueryDto,
  ): Promise<EscalationPageDto> {
    const now = new Date();
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;

    const where: Prisma.EscalationWhereInput = {
      ...(caller.role === Role.CLINICIAN
        ? { child: { clinicianAssignments: { some: { clinicianId: caller.id } } } }
        : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.overdue
        ? {
            status: { in: [EscalationStatus.OPEN, EscalationStatus.ACKNOWLEDGED] },
            dueAt: { lt: now },
          }
        : {}),
    };

    const rows = await this.prisma.escalation.findMany({
      where,
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });
    const page = toCursorPage(rows, limit, (row) => row.id);
    const names = new Map<string, string | null>();
    for (const childId of new Set(page.data.map((r) => r.childId))) {
      names.set(childId, await assignedClinicianName(this.prisma, childId));
    }
    return {
      data: page.data.map((row) => EscalationDto.from(row, names.get(row.childId) ?? null, now)),
      nextCursor: page.nextCursor,
    };
  }
}
