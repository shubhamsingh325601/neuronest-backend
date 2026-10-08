import { ApiProperty } from '@nestjs/swagger';

export class AiUsageTokensDto {
  @ApiProperty()
  input!: number;

  @ApiProperty()
  output!: number;
}

export class AiUsageByModelDto {
  @ApiProperty({ example: 'google' })
  provider!: string;

  @ApiProperty({ example: 'gemini-3.5-flash-lite' })
  model!: string;

  @ApiProperty({ description: 'Provider attempts made (rejected-by-budget runs excluded).' })
  requests!: number;

  @ApiProperty()
  inputTokens!: number;

  @ApiProperty()
  outputTokens!: number;
}

export class AiUsageErrorClassDto {
  @ApiProperty({ example: 'APICallError', description: 'Error class name only; never a message.' })
  errorClass!: string;

  @ApiProperty()
  count!: number;
}

/** Fixed shape for the current Pacific day (plan 0018 §6) — not a generic analytics endpoint. */
export class AiUsageResponseDto {
  @ApiProperty({
    example: '2026-10-07',
    description: 'The America/Los_Angeles calendar day the counts cover (provider quotas reset here).',
  })
  date!: string;

  @ApiProperty({ description: 'Provider attempts made today; rejected-by-budget runs excluded.' })
  requestsUsed!: number;

  @ApiProperty({ description: 'Configured `AI_DAILY_REQUEST_BUDGET`.' })
  requestBudget!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { SUCCEEDED: 4, RATE_LIMITED: 1, REJECTED_BUDGET: 0 },
    description: 'Every AiRunStatus, zero-filled. REJECTED_BUDGET is shown here but is not budget spend.',
  })
  requestsByStatus!: Record<string, number>;

  @ApiProperty({ type: AiUsageTokensDto })
  tokens!: AiUsageTokensDto;

  @ApiProperty({
    description: 'Paid-equivalent estimate in millionths of a USD; the free tier still records it.',
  })
  costEstimateMicroUsd!: number;

  @ApiProperty({ type: [AiUsageByModelDto] })
  byModel!: AiUsageByModelDto[];

  @ApiProperty({ type: [AiUsageErrorClassDto] })
  errorsByClass!: AiUsageErrorClassDto[];
}
