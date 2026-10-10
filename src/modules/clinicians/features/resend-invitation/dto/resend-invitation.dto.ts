import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ResendInvitationDto {
  @ApiPropertyOptional({
    example: 'https://app.example.com/complete-account-setup',
    description: 'Frontend page the emailed link opens (API appends ?token=…). Must be on APP_WEB_URL or a CORS_ORIGINS origin, else 400 INVALID_CALLBACK_URL.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  callbackUrl?: string;
}
