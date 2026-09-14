import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The single error shape every failed request returns —
 * [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) *Problem Details for HTTP APIs*.
 * Produced by {@link AllExceptionsFilter}; served as `application/problem+json`.
 *
 * `code`, `requestId`, `timestamp` (and `errors`, when present) are documented
 * extension members — nothing from the previous custom shape is lost, it is repackaged.
 */
export class ProblemDetailsDto {
  @ApiProperty({
    description:
      'Stable URI identifying the problem type. Built from `code` (kebab-case); ' +
      'need not resolve to a live page.',
    example: 'https://docs.neuronest.dev/problems/invalid-credentials',
  })
  type!: string;

  @ApiProperty({
    description: 'Short, human-readable summary of the problem type. Same wording every time this type occurs.',
    example: 'Invalid Credentials',
  })
  title!: string;

  @ApiProperty({ description: 'HTTP status code, repeated for convenience.', example: 401 })
  status!: number;

  @ApiProperty({
    description: 'Human-readable explanation specific to this occurrence.',
    example: 'Email or password is incorrect.',
  })
  detail!: string;

  @ApiProperty({
    description: 'URI reference for this specific occurrence — the request path.',
    example: '/v1/auth/login',
  })
  instance!: string;

  @ApiProperty({
    description: 'Stable machine-readable error code (extension member).',
    example: 'INVALID_CREDENTIALS',
  })
  code!: string;

  @ApiProperty({
    description: 'Correlates with the structured request log (extension member).',
    example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
    nullable: true,
  })
  requestId!: string | null;

  @ApiProperty({
    description: 'ISO 8601 timestamp of the response (extension member).',
    example: '2026-08-30T00:00:00.000Z',
  })
  timestamp!: string;

  @ApiPropertyOptional({
    description:
      'Present only for validation failures: the individual class-validator messages. ' +
      '`detail` is the same list joined with "; ".',
    example: ['email must be an email', 'password is not strong enough'],
    type: [String],
  })
  errors?: string[];
}
