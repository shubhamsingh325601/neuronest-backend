import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'parent@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({
    example: 'https://app.example.com/reset-password',
    description: 'Frontend page the emailed link opens (API appends ?token=…). Must be on APP_WEB_URL or a CORS_ORIGINS origin, else 400 INVALID_CALLBACK_URL.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  callbackUrl?: string;
}
