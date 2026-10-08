import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ESCALATION_CATEGORIES } from '@modules/escalations/shared/escalation.constants';

export class CreateEscalationDto {
  @ApiProperty({ enum: ESCALATION_CATEGORIES })
  @IsIn(ESCALATION_CATEGORIES)
  categoryId!: string;

  @ApiProperty({ minLength: 1, maxLength: 1000, description: 'What is happening right now.' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  notes!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  whatWasTried?: string;

  @ApiPropertyOptional({ example: '+44 7700 900123' })
  @IsOptional()
  @IsString()
  @Matches(/^[+0-9()\s-]{7,20}$/)
  callbackPhone?: string;
}
