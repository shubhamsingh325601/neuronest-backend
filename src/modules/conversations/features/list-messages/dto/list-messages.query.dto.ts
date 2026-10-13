import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  MESSAGE_PAGE_DEFAULT,
  MESSAGE_PAGE_MAX,
} from '@modules/conversations/shared/message-paging';

export class ListMessagesQueryDto {
  @ApiPropertyOptional({ minimum: 0, default: 0, description: 'Return messages after this seq.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  afterSeq?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: MESSAGE_PAGE_MAX, default: MESSAGE_PAGE_DEFAULT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MESSAGE_PAGE_MAX)
  limit?: number;
}
