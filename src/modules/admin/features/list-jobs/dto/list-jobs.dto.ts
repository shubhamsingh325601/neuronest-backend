import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JobStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CursorPaginationQueryDto } from '@common/pagination/cursor-pagination.query.dto';
import { JobDto } from '@modules/admin/shared/job.dto';

export class ListJobsQueryDto extends CursorPaginationQueryDto {
  @ApiPropertyOptional({ enum: JobStatus })
  @IsOptional()
  @IsEnum(JobStatus)
  status?: JobStatus;

  @ApiPropertyOptional({ example: 'email.verification-code' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  type?: string;
}

export class ListJobsResponseDto {
  @ApiProperty({ type: [JobDto] })
  data!: JobDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pass as `?cursor=` for the next page; null on the last page.',
  })
  nextCursor!: string | null;
}
