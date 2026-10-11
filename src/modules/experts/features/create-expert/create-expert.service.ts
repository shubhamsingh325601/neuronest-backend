import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, Role, UserStatus } from '@prisma/client';
import { PasswordService } from '@common/crypto/password.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { CreateExpertDto } from '@modules/experts/shared/create-expert.dto';
import { ExpertDetailDto } from '@modules/experts/shared/expert.dto';
import { findExpertDetail } from '@modules/experts/shared/find-expert-detail';

/**
 * Admin creates an expert directly: an `ACTIVE` `User` with the password the admin chose and
 * the email already trusted (no invitation, no setup link). The admin shares the password
 * with the expert, who signs in through the same login as everyone else. An existing email is
 * an admin-only disclosure (`409 EMAIL_ALREADY_REGISTERED`), not an enumeration surface.
 */
@Injectable()
export class CreateExpertService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async create(dto: CreateExpertDto): Promise<ExpertDetailDto> {
    const email = dto.email.toLowerCase().trim();
    const clash = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (clash) {
      throw emailTaken();
    }

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          name: dto.name,
          role: Role.EXPERT,
          status: UserStatus.ACTIVE,
          passwordHash: await this.passwords.hash(dto.password),
          emailVerifiedAt: new Date(),
        },
        select: { id: true },
      });
      return await findExpertDetail(this.prisma, user.id);
    } catch (err) {
      // Lost a race against another create with the same email.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw emailTaken();
      }
      throw err;
    }
  }
}

function emailTaken(): ConflictException {
  return new ConflictException({
    code: 'EMAIL_ALREADY_REGISTERED',
    message: 'A user with this email already exists.',
  });
}
