import { Injectable } from '@nestjs/common';
import { Prisma, PlanTemplateStatus, Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { DEFAULT_PAGE_LIMIT } from '@common/pagination/cursor-pagination.query.dto';
import { decodeCursor, toCursorPage } from '@common/pagination/cursor.util';
import { PrismaService } from '@common/prisma/prisma.service';
import { PlanTemplateDto } from '@modules/plans/shared/plan-template.dto';
import { ListPlanTemplatesQueryDto } from './dto/list-plan-templates.query.dto';
import { ListPlanTemplatesResponseDto } from './dto/list-plan-templates.response.dto';

/**
 * Cursor-paginated template library. `plan-template:read` scoping for CLINICIAN is a
 * *query filter*, not an existence check (docs/rbac.md decision note) — only
 * `PUBLISHED` rows are visible; `ADMIN` sees every status.
 */
@Injectable()
export class ListPlanTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    caller: AuthenticatedUser,
    query: ListPlanTemplatesQueryDto,
  ): Promise<ListPlanTemplatesResponseDto> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const where: Prisma.PlanTemplateWhereInput =
      caller.role === Role.ADMIN ? {} : { status: PlanTemplateStatus.PUBLISHED };

    const rows = await this.prisma.planTemplate.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { days: true },
      ...(query.cursor ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });

    const page = toCursorPage(rows, limit, (row) => row.id);
    return { data: page.data.map(PlanTemplateDto.from), nextCursor: page.nextCursor };
  }
}
