import { Body, Controller, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { CarePlanActivityDto } from '@modules/care-plan/shared/care-plan.dto';
import { CompleteActivityDto } from './dto/complete-activity.dto';
import { CompleteActivityService } from './complete-activity.service';

@ApiTags('care-plan')
@Controller({ path: 'children', version: '1' })
export class CompleteActivityController {
  constructor(private readonly completeActivityService: CompleteActivityService) {}

  @Post(':childId/activities/:activityId/completion')
  @Auth('activity:complete:self')
  @ApiCreatedResponse({ type: CarePlanActivityDto, description: 'Marked done.' })
  @ApiOkResponse({ type: CarePlanActivityDto, description: 'Already marked done (idempotent).' })
  @ApiOperation({
    operationId: 'activityComplete',
    summary: 'PARENT(own child): mark an activity of the active plan as done (idempotent).',
  })
  async complete(
    @Param('childId', ParseUUIDPipe) childId: string,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: CompleteActivityDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CarePlanActivityDto> {
    const { created, activity } = await this.completeActivityService.complete(
      childId,
      activityId,
      caller,
      dto,
    );
    res.status(created ? 201 : 200);
    return activity;
  }
}
