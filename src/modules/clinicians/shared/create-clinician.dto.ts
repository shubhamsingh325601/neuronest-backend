import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { ClinicianProfileInputDto } from './clinician-profile.dto';

export class CreateClinicianDto {
  @ApiProperty({ example: 'Dr. Sam Okafor', minLength: 1, maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'sam.okafor@clinic.example' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({ type: ClinicianProfileInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ClinicianProfileInputDto)
  profile?: ClinicianProfileInputDto;

  @ApiPropertyOptional({
    example: 'https://app.example.com/complete-account-setup',
    description:
      'Frontend page the emailed link opens (API appends ?token=…). Must be on APP_WEB_URL or a CORS_ORIGINS origin, else 400 INVALID_CALLBACK_URL.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  callbackUrl?: string;
}
