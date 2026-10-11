import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { ExpertDetailDto } from '@modules/experts/shared/expert.dto';
import { findExpertDetail } from '@modules/experts/shared/find-expert-detail';
import { UpdateExpertDto } from '@modules/experts/shared/update-expert.dto';

/** Admin edits an expert's name and sign-in email. A taken email is `409 EMAIL_ALREADY_REGISTERED`. */
@Injectable()
export class UpdateExpertService {
  constructor(private readonly prisma: PrismaService) {}

  async update(id: string, dto: UpdateExpertDto): Promise<ExpertDetailDto> {
    await findExpertDetail(this.prisma, id); // 404 EXPERT_NOT_FOUND

    try {
      await this.prisma.user.update({
        where: { id, role: Role.EXPERT },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.email !== undefined ? { email: dto.email.toLowerCase().trim() } : {}),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'A user with this email already exists.',
        });
      }
      throw err;
    }
    return findExpertDetail(this.prisma, id);
  }
}
