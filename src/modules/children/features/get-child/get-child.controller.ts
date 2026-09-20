import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ChildDto } from '@modules/children/shared/child.dto';
import { GetChildService } from './get-child.service';

@ApiTags('children')
@Controller({ path: 'children', version: '1' })
export class GetChildController {
  constructor(private readonly getChildService: GetChildService) {}

  @Get(':id')
  @Auth('child:read')
  @ApiOkResponse({ type: ChildDto })
  @ApiOperation({
    operationId: 'childGet',
    summary: "Read a child — the child's own parent, an assigned clinician, or admin.",
  })
  getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<ChildDto> {
    return this.getChildService.getById(id, caller);
  }
}
