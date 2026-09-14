import { ApiPropertyOptional } from '@nestjs/swagger';
import { ClinicianApplicationStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CursorPaginationQueryDto } from '@common/pagination/cursor-pagination.query.dto';

export class ListApplicationsQueryDto extends CursorPaginationQueryDto {
  @ApiPropertyOptional({ enum: ClinicianApplicationStatus })
  @IsOptional()
  @IsEnum(ClinicianApplicationStatus)
  status?: ClinicianApplicationStatus;
}
