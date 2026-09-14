import { ApiProperty } from '@nestjs/swagger';
import { Role, UserStatus } from '@prisma/client';

export class UserProfileDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'parent@example.com' })
  email!: string;

  @ApiProperty({ example: 'Jordan Rivera' })
  name!: string;

  @ApiProperty({ enum: Role, example: Role.PARENT })
  role!: Role;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status!: UserStatus;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  emailVerifiedAt!: Date | null;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  lastLoginAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}
