import { Controller, Delete, HttpCode, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { CancelAppointmentService } from './cancel-appointment.service';

@ApiTags('appointments')
@Controller({ path: 'appointments', version: '1' })
export class CancelAppointmentController {
  constructor(private readonly cancelAppointmentService: CancelAppointmentService) {}

  @Delete(':id')
  @HttpCode(204)
  @Auth('appointment:cancel:self')
  @ApiNoContentResponse({ description: 'Cancelled; the slot is free again.' })
  @ApiOperation({
    operationId: 'appointmentCancel',
    summary: "PARENT (own child): cancel a booked call before it starts.",
  })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<void> {
    await this.cancelAppointmentService.cancel(id, caller);
  }
}
