import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { decodeCursor, toCursorPage } from '@common/pagination/cursor.util';
import { DEFAULT_PAGE_LIMIT } from '@common/pagination/cursor-pagination.query.dto';
import { PrismaService } from '@common/prisma/prisma.service';
import { ClinicianDto } from '@modules/clinicians/shared/clinician.dto';
import { clinicianInclude } from '@modules/clinicians/shared/clinician.include';
import { ListCliniciansQueryDto } from './dto/list-clinicians.query.dto';
import { ListCliniciansResponseDto } from './dto/list-clinicians.response.dto';

/**
 * Admin-only directory of CLINICIAN users — feeds the assign-clinician picker and the
 * clinician management screen. Optional `?status=` and `?q=` (case-insensitive substring
 * over name/email) filters; rows carry the derived invitation timestamps.
 */
@Injectable()
export class ListCliniciansService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListCliniciansQueryDto): Promise<ListCliniciansResponseDto> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;

    const where: Prisma.UserWhereInput = {
      role: Role.CLINICIAN,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.user.findMany({
      where,
      include: clinicianInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });

    const page = toCursorPage(rows, limit, (row) => row.id);
    return { data: page.data.map(ClinicianDto.from), nextCursor: page.nextCursor };
  }
}
