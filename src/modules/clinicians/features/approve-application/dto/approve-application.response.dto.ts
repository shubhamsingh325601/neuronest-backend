import { ApiProperty } from '@nestjs/swagger';
import { ClinicianApplicationDto } from '@modules/clinicians/shared/clinician-application.dto';

export class ApproveApplicationResponseDto {
  @ApiProperty({ type: ClinicianApplicationDto })
  application!: ClinicianApplicationDto;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Id of the provisioned (INVITED) CLINICIAN user; null if it could not be resolved.',
  })
  clinicianUserId!: string | null;
}
