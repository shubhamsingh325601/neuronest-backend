import { ApiProperty } from '@nestjs/swagger';
import { UserSummaryDto } from '@modules/users/shared/user-summary.dto';

export class ListUsersResponseDto {
  @ApiProperty({ type: [UserSummaryDto] })
  data!: UserSummaryDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `?cursor=` for the next page; null on the last page.',
  })
  nextCursor!: string | null;
}
