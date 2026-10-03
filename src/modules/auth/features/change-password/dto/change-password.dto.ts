import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ description: "The caller's current password." })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ example: 'a-new-strong-passphrase', minLength: 10, maxLength: 128 })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  newPassword!: string;
}

export class ChangePasswordResponseDto {
  @ApiProperty({ example: 'PASSWORD_CHANGED' })
  status!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
