import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MediaStatus } from '@prisma/client';
import { MediaStorageService } from '@common/media-storage/media-storage.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { MediaDto } from '@modules/media/shared/media.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';

/**
 * Parent reports the outcome of their direct-to-provider upload. `PENDING` → terminal
 * is a one-way transition:
 * - Re-confirming with the **same** terminal status is an idempotent no-op (protects
 *   a double-click / retry, same shape as Phase 3's approve/reject idempotency).
 * - Re-confirming with a **different** terminal status is `409 MEDIA_ALREADY_CONFIRMED`.
 * A `status: UPLOADED` confirm is only trusted once `MediaStorageService.verifyUpload`
 * confirms the asset actually landed — the client's self-reported body is not enough
 * on its own.
 */
@Injectable()
export class ConfirmUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaStorage: MediaStorageService,
  ) {}

  async confirm(id: string, parentId: string, dto: ConfirmUploadDto): Promise<MediaDto> {
    const media = await this.prisma.media.findUnique({
      where: { id },
      include: { child: { select: { parentId: true } } },
    });
    if (!media) {
      throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', message: 'No media with that id.' });
    }
    if (media.child.parentId !== parentId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this resource.',
      });
    }

    if (media.status !== MediaStatus.PENDING) {
      if (media.status === dto.status) {
        return MediaDto.from(media);
      }
      throw new ConflictException({
        code: 'MEDIA_ALREADY_CONFIRMED',
        message: `This media was already confirmed as ${media.status}.`,
      });
    }

    if (dto.status === MediaStatus.UPLOADED) {
      const landed = await this.mediaStorage.verifyUpload(media.storageKey, media.type);
      if (!landed) {
        throw new BadRequestException({
          code: 'MEDIA_UPLOAD_NOT_VERIFIED',
          message: 'The storage provider has no asset at this ticket — the upload did not land.',
        });
      }
    }

    const updated = await this.prisma.media.update({
      where: { id },
      data: {
        status: dto.status,
        mimeType: dto.status === MediaStatus.UPLOADED ? (dto.mimeType ?? null) : null,
        sizeBytes: dto.status === MediaStatus.UPLOADED ? (dto.sizeBytes ?? null) : null,
        durationSeconds: dto.status === MediaStatus.UPLOADED ? (dto.durationSeconds ?? null) : null,
      },
    });
    return MediaDto.from(updated);
  }
}
