import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';

export class UserStatusResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: UserStatus })
  status!: UserStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
