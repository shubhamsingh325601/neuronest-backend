import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class GrantConsentDto {
  @ApiProperty({
    example: 'v1',
    description: 'Opaque consent-wording version id. The server keeps no wording catalogue.',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,64}$/, {
    message: 'consentVersion must be 1-64 characters of letters, digits, ".", "_" or "-".',
  })
  consentVersion!: string;
}
