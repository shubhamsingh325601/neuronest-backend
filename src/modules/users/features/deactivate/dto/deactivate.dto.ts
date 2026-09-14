import { ApiProperty } from '@nestjs/swagger';

export class DeactivateResponseDto {
  @ApiProperty({ example: 'DEACTIVATED' })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  selfExcludedAt!: Date;
}
