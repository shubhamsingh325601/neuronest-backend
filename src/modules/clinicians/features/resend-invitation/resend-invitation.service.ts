import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { CallbackUrlService } from '@common/email/callback-url.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { InvitationService } from '@modules/clinicians/shared/invitation.service';
import { ResendInvitationDto } from './dto/resend-invitation.dto';

/**
 * Admin re-sends the invitation to a clinician who has not activated yet. No new user
 * is created; earlier links die because issuing a token consumes outstanding ones.
 * The send is queued (202 stays accurate): a provider failure retries and, if it persists,
 * shows up as a DEAD job the admin can requeue.
 */
@Injectable()
export class ResendInvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationService,
    private readonly callbackUrls: CallbackUrlService,
  ) {}

  async resend(id: string, dto: ResendInvitationDto): Promise<void> {
    const callbackUrl = this.callbackUrls.assertAllowed(dto.callbackUrl);
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
    await this.prisma.$transaction((tx) => this.invitations.enqueue(tx, id, callbackUrl));
    await this.invitations.kick();
  }
}
