import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ConsentStateDto } from '@modules/consents/shared/consent.dto';
import { loadConsentState } from '@modules/consents/shared/consent-state';

/**
 * Records `withdrawnAt` on the open row. With no open row it is a no-op returning the
 * current state (idempotent, not an error). No deletion, retention or upload-gating
 * effect — those are D-2 decisions, out of scope for plan 0012.
 */
@Injectable()
export class WithdrawConsentService {
  constructor(private readonly prisma: PrismaService) {}

  async withdraw(childId: string, caller: AuthenticatedUser): Promise<ConsentStateDto> {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: { id: true, parentId: true },
    });
    if (!child) {
      throw new NotFoundException({ code: 'CHILD_NOT_FOUND', message: 'No child with that id.' });
    }
    if (caller.role !== Role.PARENT || child.parentId !== caller.id) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: "Only the child's parent can manage its consent.",
      });
    }

    await this.prisma.mediaConsent.updateMany({
      where: { childId, withdrawnAt: null, supersededAt: null },
      data: { withdrawnAt: new Date() },
    });
    return loadConsentState(this.prisma, childId);
  }
}
