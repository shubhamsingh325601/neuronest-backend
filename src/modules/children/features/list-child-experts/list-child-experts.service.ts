import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { ExpertChildAssignmentDto } from '@modules/experts/shared/expert-child-assignment.dto';

/** Admin lists the experts assigned to one child. A child's expert team is small, so no pagination. */
@Injectable()
export class ListChildExpertsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(childId: string): Promise<ExpertChildAssignmentDto[]> {
    const child = await this.prisma.child.findUnique({ where: { id: childId }, select: { id: true } });
    if (!child) {
      throw new NotFoundException({ code: 'CHILD_NOT_FOUND', message: 'No child with that id.' });
    }
    const rows = await this.prisma.expertChildAssignment.findMany({
      where: { childId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(ExpertChildAssignmentDto.from);
  }
}
