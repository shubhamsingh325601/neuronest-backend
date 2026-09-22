import { ApiProperty } from '@nestjs/swagger';
import { MediaDto } from '@modules/media/shared/media.dto';

export class CreateUploadTicketResponseDto {
  @ApiProperty({ type: MediaDto })
  media!: MediaDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      "Deliberately opaque/provider-shaped — pass straight to the storage provider's upload call.",
  })
  uploadParams!: Record<string, unknown>;
}
