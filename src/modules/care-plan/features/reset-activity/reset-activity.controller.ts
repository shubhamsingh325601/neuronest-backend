import { Controller, Delete, HttpCode, HttpStatus, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ResetActivityService } from './reset-activity.service';

@ApiTags('care-plan')
@Controller({ path: 'children', version: '1' })
export class ResetActivityController {
  constructor(private readonly resetActivityService: ResetActivityService) {}

  @Delete(':childId/activities/:activityId/completion')
  @Auth('activity:complete:self')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'The activity is no longer marked done (idempotent).' })
  @ApiOperation({
    operationId: 'activityReset',
    summary: 'PARENT(own child): undo "done" on an activity of the active plan (idempotent).',
  })
  async reset(
    @Param('childId', ParseUUIDPipe) childId: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<void> {
    await this.resetActivityService.reset(childId, activityId, caller);
  }
}
