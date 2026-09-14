import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class LogoutDto {
  @ApiProperty({ description: 'The refresh token to revoke.' })
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  refreshToken!: string;
}
