import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  @ApiProperty({
    minLength: 1,
    maxLength: 100,
    description:
      'Chosen by the client for each message. Sending the same id again returns the stored message instead of a second one.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  clientMessageId!: string;
}
