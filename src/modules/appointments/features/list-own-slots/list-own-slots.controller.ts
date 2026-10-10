import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ListOwnSlotsQueryDto, ListOwnSlotsResponseDto } from './dto/list-own-slots.dto';
import { ListOwnSlotsService } from './list-own-slots.service';

@ApiTags('appointments')
@Controller({ path: 'appointment-slots', version: '1' })
export class ListOwnSlotsController {
  constructor(private readonly listOwnSlotsService: ListOwnSlotsService) {}

  @Get()
  @Auth('appointment-slot:manage')
  @ApiOkResponse({ type: ListOwnSlotsResponseDto })
  @ApiOperation({
    operationId: 'appointmentSlotListOwn',
    summary:
      'CLINICIAN (own) / ADMIN (all, or one with `clinicianId`): published slots that have not ended, soonest first, with booked state.',
  })
  list(
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: ListOwnSlotsQueryDto,
  ): Promise<ListOwnSlotsResponseDto> {
    return this.listOwnSlotsService.list(caller, query);
  }
}
