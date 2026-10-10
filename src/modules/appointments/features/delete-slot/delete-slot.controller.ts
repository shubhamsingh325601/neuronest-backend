import { Controller, Delete, HttpCode, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { DeleteSlotService } from './delete-slot.service';

@ApiTags('appointments')
@Controller({ path: 'appointment-slots', version: '1' })
export class DeleteSlotController {
  constructor(private readonly deleteSlotService: DeleteSlotService) {}

  @Delete(':id')
  @HttpCode(204)
  @Auth('appointment-slot:manage')
  @ApiNoContentResponse({ description: 'Slot removed.' })
  @ApiOperation({
    operationId: 'appointmentSlotDelete',
    summary: 'CLINICIAN (own) / ADMIN: remove a slot nobody has booked yet.',
  })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<void> {
    await this.deleteSlotService.delete(id, caller);
  }
}
