import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { InvitationService } from '@modules/clinicians/shared/invitation.service';

/**
 * Admin re-sends the invitation to a clinician who has not activated yet. No new user
 * is created; earlier links die because issuing a token consumes outstanding ones.
 * Unlike create/update this is an explicit admin action, so a mail failure is *not*
 * swallowed — the admin should see it fail rather than assume the mail went out.
 */
@Injectable()
export class ResendInvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationService,
  ) {}

  async resend(id: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id, role: Role.CLINICIAN },
      select: { id: true, status: true },
    });
    if (!user) {
      throw new NotFoundException({
        code: 'CLINICIAN_NOT_FOUND',
        message: 'No clinician with that id.',
      });
    }
    if (user.status !== UserStatus.INVITED) {
      throw new ConflictException({
        code: 'CLINICIAN_NOT_INVITED',
        message: 'Only a clinician who has not yet activated can be re-invited.',
      });
    }
    await this.invitations.issueAndSend(id);
  }
}
