import { Module } from '@nestjs/common';
import { CreateUploadTicketController } from './features/create-upload-ticket/create-upload-ticket.controller';
import { CreateUploadTicketService } from './features/create-upload-ticket/create-upload-ticket.service';
import { ConfirmUploadController } from './features/confirm-upload/confirm-upload.controller';
import { ConfirmUploadService } from './features/confirm-upload/confirm-upload.service';
import { ListMediaController } from './features/list-media/list-media.controller';
import { ListMediaService } from './features/list-media/list-media.service';

/**
 * Media upload (Phase 5): photos/videos a parent captures of their child. Depends on
 * `children`'s `Child`/`ClinicianChildAssignment` tables directly via Prisma — no
 * cross-module service import needed, Prisma is the data-access layer for both.
 */
@Module({
  controllers: [CreateUploadTicketController, ConfirmUploadController, ListMediaController],
  providers: [CreateUploadTicketService, ConfirmUploadService, ListMediaService],
})
export class MediaModule {}
