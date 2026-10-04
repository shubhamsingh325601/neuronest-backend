import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MinLength, ValidateIf } from 'class-validator';

export class UpsertPlanDayDto {
  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1)
  instructions!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "A section id of this same plan; null clears the day's section.",
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  sectionId?: string | null;
}
