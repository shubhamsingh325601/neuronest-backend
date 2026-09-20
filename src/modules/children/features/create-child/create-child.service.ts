import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { ChildDto } from '@modules/children/shared/child.dto';
import { CreateChildDto } from './dto/create-child.dto';

/**
 * Parent creates their own child record. `Child.parentId` is a unique FK, so a
 * second attempt by the same parent is a real conflict — a parent has exactly one
 * child (locked business rule), not an upsert.
 */
@Injectable()
export class CreateChildService {
  constructor(private readonly prisma: PrismaService) {}

  async create(parentId: string, dto: CreateChildDto): Promise<ChildDto> {
    const existing = await this.prisma.child.findUnique({
      where: { parentId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'CHILD_ALREADY_EXISTS',
        message: 'You already have a child on your account.',
      });
    }

    const child = await this.prisma.child.create({
      data: {
        parentId,
        name: dto.name.trim(),
        dateOfBirth: new Date(dto.dateOfBirth),
      },
    });
    return ChildDto.from(child);
  }
}
