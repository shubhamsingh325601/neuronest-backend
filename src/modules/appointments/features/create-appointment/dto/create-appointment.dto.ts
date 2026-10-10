import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateAppointmentDto {
  @ApiProperty({
    format: 'uuid',
    description: 'A free, future slot of a clinician assigned to the child.',
  })
  @IsUUID()
  slotId!: string;
}
