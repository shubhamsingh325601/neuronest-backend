import { ApiProperty } from '@nestjs/swagger';
import { MediaDto } from '@modules/media/shared/media.dto';

export class ListMediaResponseDto {
  @ApiProperty({ type: [MediaDto] })
  data!: MediaDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `?cursor=` for the next page; null on the last page.',
  })
  nextCursor!: string | null;
}
