import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import {
  ListAppointmentsQueryDto,
  ListAppointmentsResponseDto,
} from '@modules/appointments/shared/appointment.dto';
import { ListChildAppointmentsService } from './list-child-appointments.service';

@ApiTags('appointments')
@Controller({ path: 'children', version: '1' })
export class ListChildAppointmentsController {
  constructor(private readonly listChildAppointmentsService: ListChildAppointmentsService) {}

  @Get(':childId/appointments')
  @Auth('appointment:read')
  @ApiOkResponse({ type: ListAppointmentsResponseDto })
  @ApiOperation({
    operationId: 'appointmentListForChild',
    summary: "A child's appointments with the clinician's name — parent (own), assigned clinician, or admin.",
  })
  list(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: ListAppointmentsQueryDto,
  ): Promise<ListAppointmentsResponseDto> {
    return this.listChildAppointmentsService.list(childId, caller, query);
  }
}
