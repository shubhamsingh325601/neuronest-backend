import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const DEVICE_PLATFORMS = ['android', 'ios'] as const;

export class RegisterDeviceDto {
  @ApiProperty({
    description: "The phone's Firebase Cloud Messaging registration token.",
    maxLength: 1024,
  })
  @IsString()
  @MinLength(10)
  @MaxLength(1024)
  token!: string;

  @ApiPropertyOptional({ enum: DEVICE_PLATFORMS, default: 'android' })
  @IsOptional()
  @IsIn(DEVICE_PLATFORMS)
  platform?: (typeof DEVICE_PLATFORMS)[number];
}
