import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CompleteActivityDto {
  @ApiPropertyOptional({
    maxLength: 500,
    description: 'Optional note the parent adds when marking done.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
