import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Reset with EITHER the link `token` (web) OR the emailed 6-digit `code` plus the account `email` (mobile).
 * The service rejects a body that has neither or mixes the two.
 */
export class ResetPasswordDto {
  @ApiPropertyOptional({ description: 'The token from the reset link (web).' })
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  token?: string;

  @ApiPropertyOptional({ description: 'Account email, required with `code` (mobile).' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({
    example: '123456',
    description: '6-digit code from the reset email (mobile).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  code?: string;

  @ApiProperty({ example: 'a-new-strong-passphrase', minLength: 10, maxLength: 128 })
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  newPassword!: string;
}

export class ResetPasswordResponseDto {
  @ApiProperty({ example: true })
  reset!: boolean;
}
