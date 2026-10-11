import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class SetExpertChildrenDto {
  @ApiProperty({
    type: [String],
    maxItems: 500,
    description: "The expert's complete set of children. Empty clears it; ids not listed are unassigned.",
  })
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  childIds!: string[];
}
