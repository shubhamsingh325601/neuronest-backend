import { ApiPropertyOptional } from '@nestjs/swagger';
import { PlanStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CursorPaginationQueryDto } from '@common/pagination/cursor-pagination.query.dto';

export class ListPlansQueryDto extends CursorPaginationQueryDto {
  @ApiPropertyOptional({ enum: PlanStatus })
  @IsOptional()
  @IsEnum(PlanStatus)
  status?: PlanStatus;
}
