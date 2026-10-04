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
import { resolvePlaybackUrl } from '@modules/media/shared/resolve-playback-url';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';

/**
 * Parent reports the outcome of their direct-to-provider upload. `PENDING` → terminal
 * is a one-way transition:
 * - Re-confirming with the **same** terminal status is an idempotent no-op (protects
 *   a double-click / retry, same shape as Phase 3's approve/reject idempotency).
 * - Re-confirming with a **different** terminal status is `409 MEDIA_ALREADY_CONFIRMED`.
 * A `status: UPLOADED` confirm is only trusted once `MediaStorageService.inspectUpload`
 * finds the asset at the provider, and the persisted mimeType / sizeBytes / durationSeconds
 * come from that lookup — the client's self-reported body is ignored.
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
        return MediaDto.from(media, await resolvePlaybackUrl(this.mediaStorage, media));
      }
      throw new ConflictException({
        code: 'MEDIA_ALREADY_CONFIRMED',
        message: `This media was already confirmed as ${media.status}.`,
      });
    }

    let metadata: { mimeType: string | null; sizeBytes: number | null; durationSeconds: number | null } = {
      mimeType: null,
      sizeBytes: null,
      durationSeconds: null,
    };
    if (dto.status === MediaStatus.UPLOADED) {
      const asset = await this.mediaStorage.inspectUpload(media.storageKey, media.type);
      if (!asset) {
        throw new BadRequestException({
          code: 'MEDIA_UPLOAD_NOT_VERIFIED',
          message: 'The storage provider has no asset at this ticket — the upload did not land.',
        });
      }
      // Provider-verified values only; the request's mimeType/sizeBytes/durationSeconds are ignored.
      metadata = {
        mimeType: asset.mimeType,
        sizeBytes: asset.bytes,
        durationSeconds: asset.durationSeconds,
      };
    }

    const updated = await this.prisma.media.update({
      where: { id },
      data: { status: dto.status, ...metadata },
    });
    return MediaDto.from(updated, await resolvePlaybackUrl(this.mediaStorage, updated));
  }
}
