import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class StreamProbeQueryDto {
  /** Total length of the stream. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  seconds?: number = 10;

  /** Gap between `tick` events. A large gap with `heartbeatSeconds=0` tests idle cut-offs. */
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(60_000)
  tickMs?: number = 500;

  /** Interval of `: hb` comment lines; 0 disables them. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  heartbeatSeconds?: number = 0;

  /** 0 omits the anti-buffering response headers, to see whether the host honours them. */
  @IsOptional()
  @IsIn([0, 1])
  hints?: number = 1;
}
