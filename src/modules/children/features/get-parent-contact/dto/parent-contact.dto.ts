import { ApiProperty } from '@nestjs/swagger';

/** How to reach a child's parent. There is no stored parent phone number yet (plan 0019 §5). */
export class ParentContactDto {
  @ApiProperty({ example: 'Alex Parent' })
  name!: string;

  @ApiProperty({ example: 'alex.parent@example.com' })
  email!: string;
}
