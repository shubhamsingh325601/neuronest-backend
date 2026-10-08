import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdatePreferencesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  coachingInApp?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  coachingEmail?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  coachingWhatsapp?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  appointmentReminders?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  consultationArchive?: boolean;
}