import { ApiProperty } from '@nestjs/swagger';

/** Fixed flat shape (§3 row 12 of plan 0008) — not a generic analytics endpoint. */
export class AdminSummaryResponseDto {
  @ApiProperty()
  invitedClinicians!: number;

  @ApiProperty()
  activeClinicians!: number;

  @ApiProperty()
  activeParents!: number;

  @ApiProperty()
  activePlans!: number;

  @ApiProperty()
  childrenWithAssignedClinician!: number;

  @ApiProperty()
  childrenWithoutClinician!: number;

  @ApiProperty({
    description: 'Background jobs in DEAD (the error list) awaiting an admin requeue.',
  })
  deadJobs!: number;
}
