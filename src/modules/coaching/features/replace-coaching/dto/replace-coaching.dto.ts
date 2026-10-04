import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class CoachingTipInputDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}

export class ReplaceCoachingDto {
  @ApiProperty({
    type: [CoachingTipInputDto],
    maxItems: 5,
    description: 'The full tip set for the week, in display order. An empty array clears the week.',
  })
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => CoachingTipInputDto)
  tips!: CoachingTipInputDto[];
}
