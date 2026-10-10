import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

export class SavePreparationDto {
  @ApiProperty({
    type: [String],
    maxItems: 20,
    description: 'Plan-goal ids the parent wants to cover.',
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  topicIds!: string[];

  @ApiProperty({
    type: [String],
    maxItems: 20,
    description: 'Preparation steps the parent ticked.',
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  checklistIds!: string[];
}
