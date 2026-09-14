import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ClinicianApplicationDto } from '@modules/clinicians/shared/clinician-application.dto';

export class RejectApplicationDto {
  @ApiPropertyOptional({
    maxLength: 2000,
    description: 'Optional free-text reason, stored on the application as reviewNote.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class RejectApplicationResponseDto {
  @ApiProperty({ type: ClinicianApplicationDto })
  application!: ClinicianApplicationDto;
}
