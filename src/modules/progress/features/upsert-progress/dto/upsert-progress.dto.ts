import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { IsDateOnlyNotFuture } from '@common/validation/is-date-only-not-future.decorator';
import {
  BEHAVIOUR_MAX,
  BEHAVIOUR_MIN,
  MOOD_MAX,
  MOOD_MIN,
  NOTE_MAX_LENGTH,
  SLEEP_MAX_MINUTES,
  SLEEP_MIN_MINUTES,
} from '@modules/progress/shared/progress.constants';

export class UpsertProgressParamsDto {
  @IsUUID()
  childId!: string;

  @IsDateOnlyNotFuture()
  entryDate!: string;
}

/** PUT semantics: the entry becomes exactly this body (omitted fields are stored as null). */
export class UpsertProgressDto {
  @ApiPropertyOptional({ minimum: MOOD_MIN, maximum: MOOD_MAX })
  @IsOptional()
  @IsInt()
  @Min(MOOD_MIN)
  @Max(MOOD_MAX)
  mood?: number;

  @ApiPropertyOptional({ minimum: BEHAVIOUR_MIN, maximum: BEHAVIOUR_MAX })
  @IsOptional()
  @IsInt()
  @Min(BEHAVIOUR_MIN)
  @Max(BEHAVIOUR_MAX)
  behaviour?: number;

  @ApiPropertyOptional({ minimum: SLEEP_MIN_MINUTES, maximum: SLEEP_MAX_MINUTES })
  @IsOptional()
  @IsInt()
  @Min(SLEEP_MIN_MINUTES)
  @Max(SLEEP_MAX_MINUTES)
  sleepMinutes?: number;

  @ApiPropertyOptional({ maxLength: NOTE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX_LENGTH)
  note?: string;
}
