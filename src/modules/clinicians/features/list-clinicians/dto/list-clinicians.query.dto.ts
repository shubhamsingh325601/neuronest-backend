import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CursorPaginationQueryDto } from '@common/pagination/cursor-pagination.query.dto';

export class ListCliniciansQueryDto extends CursorPaginationQueryDto {
  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    maxLength: 100,
    description: 'Case-insensitive substring match over name and email.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
