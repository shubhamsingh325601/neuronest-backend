import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { ClinicianDetailDto } from '@modules/clinicians/shared/clinician-detail.dto';
import { findClinicianDetail } from '@modules/clinicians/shared/find-clinician-detail';
import { VerificationTokenService } from '@modules/auth/shared/verification-token.service';
import { InvitationService } from '@modules/clinicians/shared/invitation.service';
import { UpdateClinicianDto } from '@modules/clinicians/shared/update-clinician.dto';

/**
 * Admin edits a clinician's name, profile (upserted — legacy clinicians have no row)
 * and email. The email can change only while `INVITED` (`409 CLINICIAN_EMAIL_LOCKED`
 * afterwards — a post-activation change needs a verification flow, out of scope). An
 * email change re-invites the **new** address; issuing that token consumes the old
 * address's outstanding link. Re-sending the current email is a no-op, not a lock error.
 */
@Injectable()
export class UpdateClinicianService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationService,
    private readonly verificationTokens: VerificationTokenService,
  ) {}

  async update(id: string, dto: UpdateClinicianDto): Promise<ClinicianDetailDto> {
    const user = await this.prisma.user.findFirst({
      where: { id, role: Role.CLINICIAN },
      select: { id: true, email: true, status: true },
    });
    if (!user) {
      throw new NotFoundException({
        code: 'CLINICIAN_NOT_FOUND',
        message: 'No clinician with that id.',
      });
    }

    const newEmail = dto.email?.toLowerCase().trim();
    const emailChanged = newEmail !== undefined && newEmail !== user.email;
    if (emailChanged) {
      if (user.status !== UserStatus.INVITED) {
        throw new ConflictException({
          code: 'CLINICIAN_EMAIL_LOCKED',
          message: 'The email can only be changed while the clinician is still invited.',
        });
      }
      const clash = await this.prisma.user.findUnique({
        where: { email: newEmail },
        select: { id: true },
      });
      if (clash) {
        throw emailTaken();
      }
    }

    try {
      // An email change queues the new invitation in the same transaction as the update.
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(emailChanged ? { email: newEmail } : {}),
            ...(dto.profile
              ? {
                  clinicianProfile: {
                    upsert: { create: { ...dto.profile }, update: { ...dto.profile } },
                  },
                }
              : {}),
          },
        });
        if (emailChanged) {
          // The old address's link dies now, not when the queued send eventually runs.
          await this.verificationTokens.revokeAccountSetup(id, tx);
          await this.invitations.enqueue(tx, id);
        }
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw emailTaken();
      }
      throw err;
    }

    if (emailChanged) {
      await this.invitations.kick();
    }
    return findClinicianDetail(this.prisma, id);
  }
}

function emailTaken(): ConflictException {
  return new ConflictException({
    code: 'EMAIL_ALREADY_REGISTERED',
    message: 'A user with this email already exists.',
  });
}
