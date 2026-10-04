import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { CoachingWeekDto } from '@modules/coaching/shared/coaching.dto';
import { ListCoachingQueryDto } from './dto/list-coaching.query.dto';
import { ListCoachingService } from './list-coaching.service';

@ApiTags('coaching')
@Controller({ path: 'children', version: '1' })
export class ListCoachingController {
  constructor(private readonly listCoachingService: ListCoachingService) {}

  @Get(':childId/coaching')
  @Auth('coaching:read')
  @ApiOkResponse({ type: CoachingWeekDto })
  @ApiOperation({
    operationId: 'coachingList',
    summary: "Weekly coaching tips for a child's active plan — parent (own), assigned clinician, or admin.",
  })
  list(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: ListCoachingQueryDto,
  ): Promise<CoachingWeekDto> {
    return this.listCoachingService.list(childId, caller, query);
  }
}
