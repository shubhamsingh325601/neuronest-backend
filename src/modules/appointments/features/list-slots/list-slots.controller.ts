import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ListSlotsQueryDto, ListSlotsResponseDto } from './dto/list-slots.dto';
import { ListSlotsService } from './list-slots.service';

@ApiTags('appointments')
@Controller({ path: 'children', version: '1' })
export class ListSlotsController {
  constructor(private readonly listSlotsService: ListSlotsService) {}

  @Get(':childId/appointment-slots')
  @Auth('appointment-slot:read')
  @ApiOkResponse({ type: ListSlotsResponseDto })
  @ApiOperation({
    operationId: 'appointmentSlotList',
    summary:
      'Free future slots of the clinicians assigned to a child — parent (own), assigned clinician, or admin.',
  })
  list(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: ListSlotsQueryDto,
  ): Promise<ListSlotsResponseDto> {
    return this.listSlotsService.list(childId, caller, query);
  }
}
