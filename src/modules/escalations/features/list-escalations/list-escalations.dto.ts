import { ApiPropertyOptional } from '@nestjs/swagger';
import { EscalationStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { CursorPaginationQueryDto } from '@common/pagination/cursor-pagination.query.dto';

export class ListEscalationsQueryDto extends CursorPaginationQueryDto {
  @ApiPropertyOptional({ enum: EscalationStatus })
  @IsOptional()
  @IsEnum(EscalationStatus)
  status?: EscalationStatus;

  @ApiPropertyOptional({ description: 'Only active requests past their 24 h deadline.' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overdue?: boolean;
}
