import { ApiProperty } from '@nestjs/swagger';
import { ExpertDto } from '@modules/experts/shared/expert.dto';

export class ListExpertsResponseDto {
  @ApiProperty({ type: [ExpertDto] })
  data!: ExpertDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `?cursor=` for the next page; null on the last page.',
  })
  nextCursor!: string | null;
}
