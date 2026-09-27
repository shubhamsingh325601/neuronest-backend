import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ListChildrenQueryDto } from './dto/list-children.query.dto';
import { ListChildrenResponseDto } from './dto/list-children.response.dto';
import { ListChildrenService } from './list-children.service';

@ApiTags('children')
@Controller({ path: 'children', version: '1' })
export class ListChildrenController {
  constructor(private readonly listChildrenService: ListChildrenService) {}

  @Get()
  @Auth('child:read')
  @ApiOkResponse({ type: ListChildrenResponseDto })
  @ApiOperation({
    operationId: 'childList',
    summary:
      "Cursor-paginated children visible to the caller — the parent's own child, a clinician's assigned caseload, or all children for admin.",
  })
  list(
    @Query() query: ListChildrenQueryDto,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<ListChildrenResponseDto> {
    return this.listChildrenService.list(query, caller);
  }
}
