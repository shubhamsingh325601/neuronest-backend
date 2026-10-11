import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { ExpertChildAssignmentDto } from '@modules/experts/shared/expert-child-assignment.dto';
import { SetExpertChildrenDto } from './dto/set-expert-children.dto';

/**
 * Admin replaces an expert's whole set of children in one transaction: links not listed are
 * deleted, new ones created, existing ones kept (so repeating a call changes nothing). A
 * suspended or deactivated expert can only be cleared.
 */
@Injectable()
export class SetExpertChildrenService {
  constructor(private readonly prisma: PrismaService) {}

  async set(expertId: string, dto: SetExpertChildrenDto): Promise<ExpertChildAssignmentDto[]> {
    const expert = await this.prisma.user.findFirst({
      where: { id: expertId, role: Role.EXPERT },
      select: { status: true },
    });
    if (!expert) {
      throw new NotFoundException({ code: 'EXPERT_NOT_FOUND', message: 'No expert with that id.' });
    }

    const { childIds } = dto;
    if (childIds.length > 0) {
      if (expert.status !== UserStatus.ACTIVE) {
        throw new ConflictException({
          code: 'EXPERT_NOT_ACTIVE',
          message: 'This expert is suspended or deactivated and cannot be assigned children.',
        });
      }
      const found = await this.prisma.child.count({ where: { id: { in: childIds } } });
      if (found !== childIds.length) {
        throw new NotFoundException({
          code: 'CHILD_NOT_FOUND',
          message: 'One or more children do not exist.',
        });
      }
    }

    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.expertChildAssignment.deleteMany({
        where: { expertId, childId: { notIn: childIds } },
      });
      await tx.expertChildAssignment.createMany({
        data: childIds.map((childId) => ({ expertId, childId })),
        skipDuplicates: true,
      });
      return tx.expertChildAssignment.findMany({
        where: { expertId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    });
    return rows.map(ExpertChildAssignmentDto.from);
  }
}
