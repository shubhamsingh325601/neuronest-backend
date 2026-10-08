import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ResolveEscalationDto {
  @ApiPropertyOptional({ maxLength: 1000, description: 'A short note the parent can read.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
