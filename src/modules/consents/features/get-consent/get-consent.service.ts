import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ConsentStateDto } from '@modules/consents/shared/consent.dto';
import { loadConsentState } from '@modules/consents/shared/consent-state';

/**
 * `consent:read` is held by PARENT and ADMIN only (clinicians are excluded — plan 0012
 * decision 5). Ownership is enforced here: a PARENT must be the child's own parent.
 */
@Injectable()
export class GetConsentService {
  constructor(private readonly prisma: PrismaService) {}

  async get(childId: string, caller: AuthenticatedUser): Promise<ConsentStateDto> {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: { id: true, parentId: true },
    });
    if (!child) {
      throw new NotFoundException({ code: 'CHILD_NOT_FOUND', message: 'No child with that id.' });
    }
    if (caller.role === Role.PARENT && child.parentId !== caller.id) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this resource.',
      });
    }
    // ADMIN: no check.
    return loadConsentState(this.prisma, childId);
  }
}
