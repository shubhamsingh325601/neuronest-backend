import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ description: 'The refresh token issued by login or a prior refresh.' })
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  refreshToken!: string;
}
