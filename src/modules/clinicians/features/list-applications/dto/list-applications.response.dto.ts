import { ApiProperty } from '@nestjs/swagger';
import { ClinicianApplicationDto } from '@modules/clinicians/shared/clinician-application.dto';

export class ListApplicationsResponseDto {
  @ApiProperty({ type: [ClinicianApplicationDto] })
  data!: ClinicianApplicationDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `?cursor=` for the next page; null on the last page.',
  })
  nextCursor!: string | null;
}
