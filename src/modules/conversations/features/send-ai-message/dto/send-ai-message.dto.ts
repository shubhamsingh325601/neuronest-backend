import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SendAiMessageDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 2000,
    description:
      'The server enforces its own, lower limit (`AI_CHAT_MAX_MESSAGE_CHARS`) and answers 422 `MESSAGE_TOO_LONG`.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  @Matches(/\S/, { message: 'text must not be blank' })
  text!: string;

  @ApiProperty({
    minLength: 1,
    maxLength: 100,
    description:
      'Chosen by the client for each message. Sending the same id again never stores a second message: it replays the stored reply, or generates one if the first attempt failed.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  clientMessageId!: string;
}
