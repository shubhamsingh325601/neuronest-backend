import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { ExpertDetailDto } from '@modules/experts/shared/expert.dto';
import { findExpertDetail } from '@modules/experts/shared/find-expert-detail';

/** Admin reads one expert: lifecycle timestamps and assigned children. */
@Injectable()
export class GetExpertService {
  constructor(private readonly prisma: PrismaService) {}

  get(id: string): Promise<ExpertDetailDto> {
    return findExpertDetail(this.prisma, id);
  }
}
