import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { CursorPaginationQueryDto } from '@common/pagination/cursor-pagination.query.dto';
import { OwnSlotDto } from '@modules/appointments/shared/own-slot.dto';

export class ListOwnSlotsQueryDto extends CursorPaginationQueryDto {
  @ApiPropertyOptional({ description: 'ADMIN only: limit the list to one clinician.' })
  @IsOptional()
  @IsUUID()
  clinicianId?: string;
}

export class ListOwnSlotsResponseDto {
  @ApiProperty({ type: [OwnSlotDto] })
  data!: OwnSlotDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `?cursor=` for the next page; null on the last page.',
  })
  nextCursor!: string | null;
}
