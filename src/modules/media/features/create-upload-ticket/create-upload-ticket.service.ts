import { randomUUID } from 'node:crypto';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MediaStorageService } from '@common/media-storage/media-storage.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { MediaDto } from '@modules/media/shared/media.dto';
import { CreateUploadTicketDto } from './dto/create-upload-ticket.dto';
import { CreateUploadTicketResponseDto } from './dto/create-upload-ticket.response.dto';

/**
 * Parent creates an upload ticket for their own child: mints a signed
 * `MediaStorageService` ticket and records a `PENDING` `Media` row. The client then
 * uploads the bytes directly to the storage provider and reports back via `confirm`.
 */
@Injectable()
export class CreateUploadTicketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaStorage: MediaStorageService,
  ) {}

  async create(
    childId: string,
    parentId: string,
    dto: CreateUploadTicketDto,
  ): Promise<CreateUploadTicketResponseDto> {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: { id: true, parentId: true },
    });
    if (!child) {
      throw new NotFoundException({ code: 'CHILD_NOT_FOUND', message: 'No child with that id.' });
    }
    if (child.parentId !== parentId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this resource.',
      });
    }

    const mediaId = randomUUID();
    const { storageKey, uploadParams } = await this.mediaStorage.createUploadTicket({
      mediaId,
      childId,
      type: dto.type,
    });

    const media = await this.prisma.media.create({
      data: {
        id: mediaId,
        childId,
        uploadedById: parentId,
        type: dto.type,
        storageKey,
        context: dto.context,
      },
    });

    return { media: MediaDto.from(media), uploadParams };
  }
}
