import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetExpertPasswordDto {
  @ApiProperty({ example: 'a-new-strong-passphrase', minLength: 10, maxLength: 128 })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  newPassword!: string;
}
