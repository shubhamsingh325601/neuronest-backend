import { ApiProperty } from '@nestjs/swagger';
import { Media, MediaProvider, MediaStatus, MediaType } from '@prisma/client';

/** Full representation of a media row, as returned to its uploading parent, an assigned clinician, or admin. */
export class MediaDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  childId!: string;

  @ApiProperty()
  uploadedById!: string;

  @ApiProperty({ enum: MediaType })
  type!: MediaType;

  @ApiProperty({ enum: MediaProvider })
  provider!: MediaProvider;

  @ApiProperty({ enum: MediaStatus })
  status!: MediaStatus;

  @ApiProperty({ type: String, nullable: true })
  mimeType!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  durationSeconds!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  sizeBytes!: number | null;

  @ApiProperty({ type: String, nullable: true })
  context!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static from(row: Media): MediaDto {
    return {
      id: row.id,
      childId: row.childId,
      uploadedById: row.uploadedById,
      type: row.type,
      provider: row.provider,
      status: row.status,
      mimeType: row.mimeType,
      durationSeconds: row.durationSeconds,
      sizeBytes: row.sizeBytes,
      context: row.context,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
