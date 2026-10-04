import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import {
  ListAppointmentsQueryDto,
  ListAppointmentsResponseDto,
} from '@modules/appointments/shared/appointment.dto';
import { ListAppointmentsService } from './list-appointments.service';

@ApiTags('appointments')
@Controller({ path: 'appointments', version: '1' })
export class ListAppointmentsController {
  constructor(private readonly listAppointmentsService: ListAppointmentsService) {}

  @Get()
  @Auth('appointment:read')
  @ApiOkResponse({ type: ListAppointmentsResponseDto })
  @ApiOperation({
    operationId: 'appointmentList',
    summary: 'CLINICIAN: own booked calls; ADMIN: all; PARENT: their child\'s.',
  })
  list(
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: ListAppointmentsQueryDto,
  ): Promise<ListAppointmentsResponseDto> {
    return this.listAppointmentsService.list(caller, query);
  }
}
