import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsDateOnlyNotFuture } from '@common/validation/is-date-only-not-future.decorator';

/** Partial update (PATCH): only the fields sent change. Send `null`-free values; to clear a text field send an empty string. */
export class UpdateChildDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: '2019-05-14', description: 'YYYY-MM-DD, not in the future.' })
  @IsOptional()
  @IsDateOnlyNotFuture()
  dateOfBirth?: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  preferredName?: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  gender?: string;

  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  primaryLanguage?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  accommodations?: string;
}
