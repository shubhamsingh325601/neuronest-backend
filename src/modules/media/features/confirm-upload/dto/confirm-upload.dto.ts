import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MediaStatus } from '@prisma/client';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

type ConfirmableStatus = Extract<MediaStatus, 'UPLOADED' | 'FAILED'>;

export class ConfirmUploadDto {
  @ApiProperty({ enum: [MediaStatus.UPLOADED, MediaStatus.FAILED] })
  @IsIn([MediaStatus.UPLOADED, MediaStatus.FAILED])
  status!: ConfirmableStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mimeType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;
}
