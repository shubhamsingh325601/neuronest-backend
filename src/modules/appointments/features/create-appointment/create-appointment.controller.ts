import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { AppointmentDto } from '@modules/appointments/shared/appointment.dto';
import { CreateAppointmentService } from './create-appointment.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';

@ApiTags('appointments')
@Controller({ path: 'children', version: '1' })
export class CreateAppointmentController {
  constructor(private readonly createAppointmentService: CreateAppointmentService) {}

  @Post(':childId/appointments')
  @Auth('appointment:create:self')
  @ApiCreatedResponse({ type: AppointmentDto })
  @ApiOperation({
    operationId: 'appointmentCreate',
    summary: "PARENT (own child): book a free slot of one of the child's assigned clinicians.",
  })
  create(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: CreateAppointmentDto,
  ): Promise<AppointmentDto> {
    return this.createAppointmentService.create(childId, caller, dto);
  }
}
