import { ApiProperty } from '@nestjs/swagger';
import { PlanDto } from '@modules/plans/shared/plan.dto';

export class ListPlansResponseDto {
  @ApiProperty({ type: [PlanDto] })
  data!: PlanDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `?cursor=` for the next page; null on the last page.',
  })
  nextCursor!: string | null;
}
