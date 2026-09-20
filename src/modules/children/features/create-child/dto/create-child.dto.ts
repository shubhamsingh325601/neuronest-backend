import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateChildDto {
  @ApiProperty({ example: 'Alex', minLength: 1, maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: '2019-05-14', description: 'ISO 8601 date, no time component.' })
  @IsDateString()
  dateOfBirth!: string;
}
