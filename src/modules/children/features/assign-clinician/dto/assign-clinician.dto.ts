import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignClinicianDto {
  @ApiProperty({ description: 'User id of an existing CLINICIAN.' })
  @IsUUID()
  clinicianId!: string;
}
