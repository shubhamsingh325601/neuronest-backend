import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { PrismaService } from '@common/prisma/prisma.service';
import { ChildDto } from '@modules/children/shared/child.dto';
import { UpdateChildDto } from './dto/update-child.dto';

/**
 * Parent edits their own child's profile. `child:update:self` reaches ADMIN through the
 * permission spread, so the service restricts the write to the child's own PARENT.
 * Empty-string text fields clear the stored value.
 */
@Injectable()
export class UpdateChildService {
  constructor(private readonly prisma: PrismaService) {}

  async update(childId: string, caller: AuthenticatedUser, dto: UpdateChildDto): Promise<ChildDto> {
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
        message: 'You do not have permission to access this resource.',
      });
    }

    const data: Record<string, string | Date | null> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.dateOfBirth !== undefined) data.dateOfBirth = new Date(dto.dateOfBirth);
    for (const key of ['preferredName', 'gender', 'primaryLanguage', 'accommodations'] as const) {
      const value = dto[key];
      if (value !== undefined) data[key] = value.trim() === '' ? null : value.trim();
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Provide at least one field to update.',
      });
    }

    const updated = await this.prisma.child.update({ where: { id: childId }, data });
    return ChildDto.from(updated);
  }
}
