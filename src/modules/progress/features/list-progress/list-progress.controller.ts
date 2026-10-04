import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ListProgressQueryDto, ListProgressResponseDto } from './dto/list-progress.dto';
import { ListProgressService } from './list-progress.service';

@ApiTags('progress')
@Controller({ path: 'children', version: '1' })
export class ListProgressController {
  constructor(private readonly listProgressService: ListProgressService) {}

  @Get(':childId/progress')
  @Auth('progress:read')
  @ApiOkResponse({ type: ListProgressResponseDto })
  @ApiOperation({
    operationId: 'progressList',
    summary:
      "A child's daily progress log, newest day first — parent (own), assigned clinician, or admin.",
  })
  list(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: ListProgressQueryDto,
  ): Promise<ListProgressResponseDto> {
    return this.listProgressService.list(childId, caller, query);
  }
}
