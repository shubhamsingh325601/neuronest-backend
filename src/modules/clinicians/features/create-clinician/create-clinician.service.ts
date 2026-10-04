import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { ClinicianDetailDto } from '@modules/clinicians/shared/clinician-detail.dto';
import { CreateClinicianDto } from '@modules/clinicians/shared/create-clinician.dto';
import { findClinicianDetail } from '@modules/clinicians/shared/find-clinician-detail';
import { InvitationService } from '@modules/clinicians/shared/invitation.service';

/**
 * Admin creates a clinician: an `INVITED` `User` (no password, email unverified) plus
 * an optional `ClinicianProfile`, in one transaction. The invitation email is sent only
 * *after* commit and is best-effort — a mail failure never rolls the clinician back
 * (the admin sees them still `INVITED` and can resend). An existing email is an
 * admin-only disclosure (`409 EMAIL_ALREADY_REGISTERED`), not an enumeration surface.
 */
@Injectable()
export class CreateClinicianService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationService,
  ) {}

  async create(dto: CreateClinicianDto): Promise<ClinicianDetailDto> {
    const email = dto.email.toLowerCase().trim();
    const clash = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (clash) {
      throw emailTaken();
    }

    let userId: string;
    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          name: dto.name,
          role: Role.CLINICIAN,
          status: UserStatus.INVITED,
          passwordHash: null,
          emailVerifiedAt: null,
          ...(dto.profile ? { clinicianProfile: { create: { ...dto.profile } } } : {}),
        },
        select: { id: true },
      });
      userId = user.id;
    } catch (err) {
      // Lost a race against another create with the same email.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw emailTaken();
      }
      throw err;
    }

    await this.invitations.sendBestEffort(userId);
    return findClinicianDetail(this.prisma, userId);
  }
}

function emailTaken(): ConflictException {
  return new ConflictException({
    code: 'EMAIL_ALREADY_REGISTERED',
    message: 'A user with this email already exists.',
  });
}
