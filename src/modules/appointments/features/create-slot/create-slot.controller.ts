import { Body, Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { AppointmentSlotDto } from '@modules/appointments/shared/appointment-slot.dto';
import { CreateSlotService } from './create-slot.service';
import { CreateSlotDto } from './dto/create-slot.dto';

@ApiTags('appointments')
@Controller({ path: 'appointment-slots', version: '1' })
export class CreateSlotController {
  constructor(private readonly createSlotService: CreateSlotService) {}

  @Post()
  @Auth('appointment-slot:manage')
  @ApiCreatedResponse({ type: AppointmentSlotDto })
  @ApiOperation({
    operationId: 'appointmentSlotCreate',
    summary: 'CLINICIAN (own) / ADMIN (clinicianId required): publish an availability slot.',
  })
  create(
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: CreateSlotDto,
  ): Promise<AppointmentSlotDto> {
    return this.createSlotService.create(caller, dto);
  }
}
