import { Controller, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { AiCoachingTipDto } from '@modules/ai-coaching/shared/ai-coaching-tip.dto';
import { GenerateCoachingTipService } from './generate-coaching-tip.service';

/** Static, like `AuthThrottle`: decorators evaluate before the config layer exists. */
const GENERATE_RATE_LIMIT = { limit: 5, ttl: 60_000 } as const;

@ApiTags('ai-coaching')
@Controller({ path: 'children', version: '1' })
export class GenerateCoachingTipController {
  constructor(private readonly generateCoachingTipService: GenerateCoachingTipService) {}

  @Post(':childId/ai-coaching-tips')
  @Auth('ai-coaching:generate:self')
  @Throttle({ default: GENERATE_RATE_LIMIT })
  @ApiCreatedResponse({ type: AiCoachingTipDto, description: 'Generated now.' })
  @ApiOkResponse({
    type: AiCoachingTipDto,
    description: "Today's tip already exists, or generation is unavailable (`status: UNAVAILABLE`).",
  })
  @ApiAcceptedResponse({
    type: AiCoachingTipDto,
    description: 'Still generating: poll `GET .../ai-coaching-tips/today`.',
  })
  @ApiOperation({
    operationId: 'aiCoachingTipGenerate',
    summary:
      "PARENT(own child): generate or return today's AI coaching tip. Idempotent per child per day (a documented POST exception, like signup).",
  })
  async generate(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AiCoachingTipDto> {
    const { statusCode, body } = await this.generateCoachingTipService.generate(childId, caller);
    res.status(statusCode);
    return body;
  }
}
