import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MediaType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateUploadTicketDto {
  @ApiProperty({ enum: MediaType })
  @IsEnum(MediaType)
  type!: MediaType;

  @ApiPropertyOptional({
    maxLength: 500,
    description: 'Free-text caller-supplied note, e.g. what the clip is of.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  context?: string;
}
