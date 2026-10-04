import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { ClinicianProfileInputDto } from './clinician-profile.dto';

export class UpdateClinicianDto {
  @ApiPropertyOptional({ example: 'Dr. Sam Okafor', minLength: 1, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    example: 'sam.okafor@clinic.example',
    description:
      'Only while the clinician is INVITED (409 CLINICIAN_EMAIL_LOCKED afterwards). A change re-invites the new address.',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ type: ClinicianProfileInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ClinicianProfileInputDto)
  profile?: ClinicianProfileInputDto;
}
