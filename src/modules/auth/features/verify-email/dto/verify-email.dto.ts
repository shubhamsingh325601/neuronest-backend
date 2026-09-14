import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({ example: 'parent@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: '123456', description: '6-digit code from the verification email.' })
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class ResendVerificationDto {
  @ApiProperty({ example: 'parent@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class VerifyEmailResponseDto {
  @ApiProperty({ example: true })
  verified!: boolean;
}
