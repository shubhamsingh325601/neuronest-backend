import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ListPlansQueryDto } from './dto/list-plans.query.dto';
import { ListPlansResponseDto } from './dto/list-plans.response.dto';
import { ListPlansService } from './list-plans.service';

@ApiTags('plans')
@Controller({ path: 'children', version: '1' })
export class ListPlansController {
  constructor(private readonly listPlansService: ListPlansService) {}

  @Get(':childId/plans')
  @Auth('plan:read')
  @ApiOkResponse({ type: ListPlansResponseDto })
  @ApiOperation({
    operationId: 'planList',
    summary:
      "Cursor-paginated plan history for a child, optionally filtered by ?status= — the child's own parent, an assigned clinician, or admin.",
  })
  list(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: ListPlansQueryDto,
  ): Promise<ListPlansResponseDto> {
    return this.listPlansService.list(childId, caller, query);
  }
}
