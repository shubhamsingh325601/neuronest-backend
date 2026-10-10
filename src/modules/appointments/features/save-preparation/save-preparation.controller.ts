import { Body, Controller, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { AppointmentDto } from '@modules/appointments/shared/appointment.dto';
import { SavePreparationDto } from './dto/save-preparation.dto';
import { SavePreparationService } from './save-preparation.service';

@ApiTags('appointments')
@Controller({ path: 'appointments', version: '1' })
export class SavePreparationController {
  constructor(private readonly savePreparationService: SavePreparationService) {}

  @Put(':id/preparation')
  @Auth('appointment:prepare:self')
  @ApiOkResponse({ type: AppointmentDto })
  @ApiOperation({
    operationId: 'appointmentSavePreparation',
    summary:
      'PARENT (own child): save the topics to cover and the preparation steps done, until the call ends.',
  })
  save(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: SavePreparationDto,
  ): Promise<AppointmentDto> {
    return this.savePreparationService.save(id, caller, dto);
  }
}
