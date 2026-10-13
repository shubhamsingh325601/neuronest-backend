import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class ImpersonatedUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: Role }) role!: Role;
}

export class ImpersonationResponseDto {
  @ApiProperty({
    description:
      'Bearer token that acts as the parent on every parent endpoint. It carries no refresh token: mint another when it expires.',
  })
  accessToken!: string;

  @ApiProperty({ description: 'Lifetime of the token in seconds.' }) expiresIn!: number;

  @ApiProperty({ type: ImpersonatedUserDto }) user!: ImpersonatedUserDto;

  @ApiProperty({ format: 'uuid', description: 'The admin who is acting as the parent.' })
  impersonatedBy!: string;
}
