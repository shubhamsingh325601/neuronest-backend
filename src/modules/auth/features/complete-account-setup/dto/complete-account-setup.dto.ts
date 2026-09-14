import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CompleteAccountSetupDto {
  @ApiProperty({ description: 'The token from the account-setup link.' })
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  token!: string;

  @ApiProperty({ example: 'a-new-strong-passphrase', minLength: 10, maxLength: 128 })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password!: string;
}

export class CompleteAccountSetupResponseDto {
  @ApiProperty({ example: true })
  complete!: boolean;
}
