import { ApiProperty } from '@nestjs/swagger';
import { CursorPaginationQueryDto } from '@common/pagination/cursor-pagination.query.dto';
import { AppointmentSlotDto } from '@modules/appointments/shared/appointment-slot.dto';

export class ListSlotsQueryDto extends CursorPaginationQueryDto {}

export class ListSlotsResponseDto {
  @ApiProperty({ type: [AppointmentSlotDto] })
  data!: AppointmentSlotDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `?cursor=` for the next page; null on the last page.',
  })
  nextCursor!: string | null;
}
