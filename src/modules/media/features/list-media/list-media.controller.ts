import { Controller, Get, Header, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ListMediaQueryDto } from './dto/list-media.query.dto';
import { ListMediaResponseDto } from './dto/list-media.response.dto';
import { ListMediaService } from './list-media.service';

@ApiTags('media')
@Controller({ path: 'children', version: '1' })
export class ListMediaController {
  constructor(private readonly listMediaService: ListMediaService) {}

  @Get(':childId/media')
  @Auth('media:read')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: ListMediaResponseDto })
  @ApiOperation({
    operationId: 'mediaList',
    summary:
      "Cursor-paginated list of a child's media — the child's own parent, an assigned clinician, or admin. Each row's playbackUrl is minted fresh per request; the response is never cacheable.",
  })
  list(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: ListMediaQueryDto,
  ): Promise<ListMediaResponseDto> {
    return this.listMediaService.list(childId, caller, query);
  }
}
