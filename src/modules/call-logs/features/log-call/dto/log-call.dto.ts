import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class LogCallDto {
  @ApiProperty({ example: '2026-09-22T15:30:00.000Z', description: 'ISO 8601 date-time.' })
  @IsDateString()
  calledAt!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
