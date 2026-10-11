import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ParentContactDto } from './dto/parent-contact.dto';
import { GetParentContactService } from './get-parent-contact.service';

@ApiTags('children')
@Controller({ path: 'children', version: '1' })
export class GetParentContactController {
  constructor(private readonly getParentContactService: GetParentContactService) {}

  @Get(':childId/parent-contact')
  @Auth('child:read')
  @ApiOkResponse({ type: ParentContactDto })
  @ApiOperation({
    operationId: 'childParentContactGet',
    summary: "A child's parent name and email — an assigned expert or admin only.",
  })
  get(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<ParentContactDto> {
    return this.getParentContactService.get(childId, caller);
  }
}
