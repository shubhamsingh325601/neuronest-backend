import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { ExpertChildAssignmentDto } from '@modules/experts/shared/expert-child-assignment.dto';

/** Admin lists the children assigned to one expert. Bounded by the 500-child set limit, so no pagination. */
@Injectable()
export class ListExpertChildrenService {
  constructor(private readonly prisma: PrismaService) {}

  async list(expertId: string): Promise<ExpertChildAssignmentDto[]> {
    const expert = await this.prisma.user.findFirst({
      where: { id: expertId, role: Role.EXPERT },
      select: { id: true },
    });
    if (!expert) {
      throw new NotFoundException({ code: 'EXPERT_NOT_FOUND', message: 'No expert with that id.' });
    }
    const rows = await this.prisma.expertChildAssignment.findMany({
      where: { expertId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(ExpertChildAssignmentDto.from);
  }
}
