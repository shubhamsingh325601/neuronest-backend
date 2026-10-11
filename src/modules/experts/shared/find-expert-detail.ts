import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { PrismaService } from '@common/prisma/prisma.service';
import { ExpertDetailDto } from './expert.dto';
import { expertDetailInclude } from './expert.include';

/** Loads one EXPERT as the admin detail DTO, or throws 404 `EXPERT_NOT_FOUND`. */
export async function findExpertDetail(prisma: PrismaService, id: string): Promise<ExpertDetailDto> {
  const row = await prisma.user.findFirst({
    where: { id, role: Role.EXPERT },
    include: expertDetailInclude,
  });
  if (!row) {
    throw new NotFoundException({ code: 'EXPERT_NOT_FOUND', message: 'No expert with that id.' });
  }
  return ExpertDetailDto.fromDetail(row);
}
