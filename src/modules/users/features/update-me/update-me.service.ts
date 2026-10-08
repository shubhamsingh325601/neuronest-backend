import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { UserProfileDto } from '@modules/users/features/get-me/dto/user-profile.dto';
import { UpdateMeDto } from './dto/update-me.dto';

/** Idempotent: applying the same name twice lands the same state. */
@Injectable()
export class UpdateMeService {
  constructor(private readonly prisma: PrismaService) {}

  async update(userId: string, dto: UpdateMeDto): Promise<UserProfileDto> {
    const name = dto.name.trim();
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { name },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          emailVerifiedAt: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });
    } catch {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'Account no longer exists.' });
    }
  }
}
