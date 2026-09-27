import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { decodeCursor, toCursorPage } from '@common/pagination/cursor.util';
import { DEFAULT_PAGE_LIMIT } from '@common/pagination/cursor-pagination.query.dto';
import { PrismaService } from '@common/prisma/prisma.service';
import { ClinicianDto } from '@modules/clinicians/shared/clinician.dto';
import { ListCliniciansQueryDto } from './dto/list-clinicians.query.dto';
import { ListCliniciansResponseDto } from './dto/list-clinicians.response.dto';

/**
 * Admin-only directory of provisioned CLINICIAN users — feeds the assign-clinician
 * picker (`POST /v1/children/{id}/clinicians`), which today requires the admin to
 * already know a `clinicianId`. No status filter: `AssignClinicianService` doesn't
 * restrict by status either, so this list matches exactly what can be assigned.
 */
@Injectable()
export class ListCliniciansService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListCliniciansQueryDto): Promise<ListCliniciansResponseDto> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;

    const rows = await this.prisma.user.findMany({
      where: { role: Role.CLINICIAN },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 } : {}),
    });

    const page = toCursorPage(rows, limit, (row) => row.id);
    return { data: page.data.map(ClinicianDto.from), nextCursor: page.nextCursor };
  }
}
