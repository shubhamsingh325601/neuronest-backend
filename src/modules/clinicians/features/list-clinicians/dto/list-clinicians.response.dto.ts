import { ApiProperty } from '@nestjs/swagger';
import { ClinicianDto } from '@modules/clinicians/shared/clinician.dto';

export class ListCliniciansResponseDto {
  @ApiProperty({ type: [ClinicianDto] })
  data!: ClinicianDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `?cursor=` for the next page; null on the last page.',
  })
  nextCursor!: string | null;
}
