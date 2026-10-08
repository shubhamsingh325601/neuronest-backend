import { Injectable } from '@nestjs/common';
import { assertChildAccess } from '@common/authz/child-access';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import {
  CursorPaginationQueryDto,
  DEFAULT_PAGE_LIMIT,
} from '@common/pagination/cursor-pagination.query.dto';
import { decodeCursor, toCursorPage } from '@common/pagination/cursor.util';
import { PrismaService } from '@common/prisma/prisma.service';
import { assignedClinicianName } from '@modules/escalations/shared/assigned-clinician';
import { EscalationDto, EscalationPageDto } from '@modules/escalations/shared/escalation.dto';

@Injectable()
export class ListChildEscalationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    childId: string,
    caller: AuthenticatedUser,
    query: CursorPaginationQueryDto,
  ): Promise<EscalationPageDto> {
    await assertChildAccess(this.prisma, childId, caller, 'read');
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const rows = await this.prisma.escalation.findMany({
      where: { childId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });
    const clinicianName = await assignedClinicianName(this.prisma, childId);
    const now = new Date();
    const page = toCursorPage(rows, limit, (row) => row.id);
    return {
      data: page.data.map((row) => EscalationDto.from(row, clinicianName, now)),
      nextCursor: page.nextCursor,
    };
  }
}
