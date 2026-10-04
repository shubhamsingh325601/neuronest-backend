import { ApiProperty } from '@nestjs/swagger';

/** Outcome counts of one `runDue()` pass. */
export class RunDueResponseDto {
  @ApiProperty()
  claimed!: number;

  @ApiProperty()
  succeeded!: number;

  @ApiProperty()
  retried!: number;

  @ApiProperty()
  dead!: number;
}
