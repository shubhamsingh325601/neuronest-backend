import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ConsentRecordDto } from '@modules/consents/shared/consent.dto';
import { GrantConsentDto } from './dto/grant-consent.dto';

export interface GrantConsentResult {
  record: ConsentRecordDto;
  /** `false` when the same version was already open (idempotent replay). */
  created: boolean;
}

/**
 * Append-only grant (plan 0012 decision 3): same version while open → the existing row;
 * a different version supersedes the open row and inserts a new one. Only the child's own
 * PARENT may grant — ADMIN holds `consent:manage:self` via the permission spread but is
 * rejected here. A concurrent double grant is settled by the partial unique index
 * (`P2002`): the loser re-reads and retries once.
 */
@Injectable()
export class GrantConsentService {
  constructor(private readonly prisma: PrismaService) {}

  async grant(
    childId: string,
    caller: AuthenticatedUser,
    dto: GrantConsentDto,
  ): Promise<GrantConsentResult> {
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

    try {
      return await this.attempt(childId, caller.id, dto.consentVersion);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.attempt(childId, caller.id, dto.consentVersion);
      }
      throw err;
    }
  }

  private attempt(
    childId: string,
    grantedById: string,
    consentVersion: string,
  ): Promise<GrantConsentResult> {
    return this.prisma.$transaction(async (tx) => {
      const open = await tx.mediaConsent.findFirst({
        where: { childId, withdrawnAt: null, supersededAt: null },
      });
      if (open?.consentVersion === consentVersion) {
        return { record: ConsentRecordDto.from(open), created: false };
      }
      if (open) {
        await tx.mediaConsent.update({
          where: { id: open.id },
          data: { supersededAt: new Date() },
        });
      }
      const row = await tx.mediaConsent.create({
        data: { childId, grantedById, consentVersion },
      });
      return { record: ConsentRecordDto.from(row), created: true };
    });
  }
}
