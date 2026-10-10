import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UnregisterDeviceDto {
  @ApiProperty({
    description: 'The Firebase Cloud Messaging token to stop sending to.',
    maxLength: 1024,
  })
  @IsString()
  @MinLength(10)
  @MaxLength(1024)
  token!: string;
}
