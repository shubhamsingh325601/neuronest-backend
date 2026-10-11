import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { assertExpertAssigned } from '@common/authz/child-access';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ParentContactDto } from './dto/parent-contact.dto';

/**
 * The parent's name and email for a child. `child:read` is held by every role, so the role
 * rule lives here: an EXPERT assigned to the child, or ADMIN. A parent (it is their own
 * data) and a clinician (not an expert task) are refused, as is any other role.
 */
@Injectable()
export class GetParentContactService {
  constructor(private readonly prisma: PrismaService) {}

  async get(childId: string, caller: AuthenticatedUser): Promise<ParentContactDto> {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: { parent: { select: { name: true, email: true } } },
    });
    if (!child) {
      throw new NotFoundException({ code: 'CHILD_NOT_FOUND', message: 'No child with that id.' });
    }

    if (caller.role === Role.EXPERT) {
      await assertExpertAssigned(this.prisma, childId, caller.id);
    } else if (caller.role !== Role.ADMIN) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this resource.',
      });
    }
    return { name: child.parent.name, email: child.parent.email };
  }
}
