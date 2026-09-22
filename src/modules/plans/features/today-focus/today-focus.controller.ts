import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { TodayFocusResponseDto } from './dto/today-focus.response.dto';
import { TodayFocusService } from './today-focus.service';

@ApiTags('plans')
@Controller({ path: 'children', version: '1' })
export class TodayFocusController {
  constructor(private readonly todayFocusService: TodayFocusService) {}

  @Get(':childId/plans/today')
  @Auth('plan:read')
  @ApiOkResponse({ type: TodayFocusResponseDto })
  @ApiOperation({
    operationId: 'planTodayFocus',
    summary:
      "Today's Focus — the child's active plan and today's template day, if any (own parent / assigned clinician / admin).",
  })
  get(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<TodayFocusResponseDto> {
    return this.todayFocusService.get(childId, caller);
  }
}
