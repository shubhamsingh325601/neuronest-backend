import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MediaStatus } from '@prisma/client';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

type ConfirmableStatus = Extract<MediaStatus, 'UPLOADED' | 'FAILED'>;

const IGNORED =
  'Accepted for backward compatibility but ignored — the server records the storage provider-reported value.';

export class ConfirmUploadDto {
  @ApiProperty({ enum: [MediaStatus.UPLOADED, MediaStatus.FAILED] })
  @IsIn([MediaStatus.UPLOADED, MediaStatus.FAILED])
  status!: ConfirmableStatus;

  @ApiPropertyOptional({ description: IGNORED })
  @IsOptional()
  @IsString()
  mimeType?: string;

  @ApiPropertyOptional({ description: IGNORED })
  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;

  @ApiPropertyOptional({ description: IGNORED })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;
}
