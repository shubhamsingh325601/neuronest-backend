import { ApiProperty } from '@nestjs/swagger';
import { PlanNoteDto } from '@modules/plans/shared/plan-note.dto';

export class ListPlanNotesResponseDto {
  @ApiProperty({ type: [PlanNoteDto] })
  data!: PlanNoteDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `?cursor=` for the next page; null on the last page.',
  })
  nextCursor!: string | null;
}
