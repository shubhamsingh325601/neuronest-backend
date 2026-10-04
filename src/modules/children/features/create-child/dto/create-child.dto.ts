import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsDateOnlyNotFuture } from '@common/validation/is-date-only-not-future.decorator';

export class CreateChildDto {
  @ApiProperty({ example: 'Alex', minLength: 1, maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({
    example: '2019-05-14',
    description: 'Date only, YYYY-MM-DD (no time component), not in the future.',
  })
  @IsDateOnlyNotFuture()
  dateOfBirth!: string;
}
