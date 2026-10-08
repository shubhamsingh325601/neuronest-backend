import { Body, Controller, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { AppointmentDto } from '@modules/appointments/shared/appointment.dto';
import { SetSummaryDto } from './dto/set-summary.dto';
import { SetSummaryService } from './set-summary.service';

@ApiTags('appointments')
@Controller({ path: 'appointments', version: '1' })
export class SetSummaryController {
  constructor(private readonly setSummaryService: SetSummaryService) {}

  @Put(':id/summary')
  @Auth('appointment:summarise')
  @ApiOkResponse({ type: AppointmentDto })
  @ApiOperation({
    operationId: 'appointmentSetSummary',
    summary: 'CLINICIAN (assigned) / ADMIN: record the call summary and agreed action points once the call has started.',
  })
  set(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: SetSummaryDto,
  ): Promise<AppointmentDto> {
    return this.setSummaryService.set(id, caller, dto);
  }
}