import { ApiProperty } from '@nestjs/swagger';
import { ChildDto } from '@modules/children/shared/child.dto';

export class ListChildrenResponseDto {
  @ApiProperty({ type: [ChildDto] })
  data!: ChildDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `?cursor=` for the next page; null on the last page.',
  })
  nextCursor!: string | null;
}
