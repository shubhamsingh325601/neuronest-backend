import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { MonthlyCallLogDto } from '@modules/call-logs/shared/monthly-call-log.dto';
import { LogCallDto } from './dto/log-call.dto';
import { LogCallService } from './log-call.service';

@ApiTags('call-logs')
@Controller({ path: 'children', version: '1' })
export class LogCallController {
  constructor(private readonly logCallService: LogCallService) {}

  @Post(':childId/call-logs')
  @Auth('monthly-call:create')
  @ApiCreatedResponse({ type: MonthlyCallLogDto })
  @ApiOperation({
    operationId: 'monthlyCallLogCreate',
    summary: "CLINICIAN(assigned)/ADMIN: log a monthly check-in call with a child's parent.",
  })
  log(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: LogCallDto,
  ): Promise<MonthlyCallLogDto> {
    return this.logCallService.log(childId, caller, dto);
  }
}
