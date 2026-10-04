import { Body, Controller, Param, ParseIntPipe, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { CoachingWeekDto } from '@modules/coaching/shared/coaching.dto';
import { ReplaceCoachingDto } from './dto/replace-coaching.dto';
import { ReplaceCoachingService } from './replace-coaching.service';

@ApiTags('coaching')
@Controller({ path: 'plans', version: '1' })
export class ReplaceCoachingController {
  constructor(private readonly replaceCoachingService: ReplaceCoachingService) {}

  @Put(':id/coaching/:weekNumber')
  @Auth('coaching:manage')
  @ApiOkResponse({ type: CoachingWeekDto })
  @ApiOperation({
    operationId: 'coachingReplace',
    summary:
      "CLINICIAN(assigned)/ADMIN: replace a plan week's coaching tips (idempotent; empty array clears).",
  })
  replace(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('weekNumber', ParseIntPipe) weekNumber: number,
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: ReplaceCoachingDto,
  ): Promise<CoachingWeekDto> {
    return this.replaceCoachingService.replace(id, weekNumber, caller, dto);
  }
}
