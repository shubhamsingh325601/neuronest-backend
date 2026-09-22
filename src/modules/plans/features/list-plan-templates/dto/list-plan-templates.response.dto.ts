import { ApiProperty } from '@nestjs/swagger';
import { PlanTemplateDto } from '@modules/plans/shared/plan-template.dto';

export class ListPlanTemplatesResponseDto {
  @ApiProperty({ type: [PlanTemplateDto] })
  data!: PlanTemplateDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `?cursor=` for the next page; null on the last page.',
  })
  nextCursor!: string | null;
}
