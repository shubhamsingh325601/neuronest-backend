import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { PrismaService } from '@common/prisma/prisma.service';
import { ClinicianDetailDto } from './clinician-detail.dto';
import { clinicianDetailInclude } from './clinician.include';

/** Loads one CLINICIAN as the admin detail DTO, or throws 404 `CLINICIAN_NOT_FOUND`. */
export async function findClinicianDetail(
  prisma: PrismaService,
  id: string,
): Promise<ClinicianDetailDto> {
  const row = await prisma.user.findFirst({
    where: { id, role: Role.CLINICIAN },
    include: clinicianDetailInclude,
  });
  if (!row) {
    throw new NotFoundException({
      code: 'CLINICIAN_NOT_FOUND',
      message: 'No clinician with that id.',
    });
  }
  return ClinicianDetailDto.fromDetail(row);
}
