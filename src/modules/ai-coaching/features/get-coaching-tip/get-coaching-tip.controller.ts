import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { AiCoachingTipDto } from '@modules/ai-coaching/shared/ai-coaching-tip.dto';
import { GetCoachingTipService } from './get-coaching-tip.service';

@ApiTags('ai-coaching')
@Controller({ path: 'children', version: '1' })
export class GetCoachingTipController {
  constructor(private readonly getCoachingTipService: GetCoachingTipService) {}

  @Get(':childId/ai-coaching-tips/today')
  @Auth('ai-coaching:read')
  @ApiOkResponse({ type: AiCoachingTipDto })
  @ApiOperation({
    operationId: 'aiCoachingTipGetToday',
    summary:
      "Today's stored AI coaching tip (`NONE` if not generated yet) — parent (own), assigned clinician, or admin. Never calls the provider.",
  })
  getToday(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<AiCoachingTipDto> {
    return this.getCoachingTipService.getToday(childId, caller);
  }
}
