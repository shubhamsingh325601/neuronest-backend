import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateExpertDto {
  @ApiPropertyOptional({ example: 'Priya Nair', minLength: 1, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    example: 'priya.nair@expert.example',
    description: 'The expert signs in with this email. 409 EMAIL_ALREADY_REGISTERED if taken.',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;
}
