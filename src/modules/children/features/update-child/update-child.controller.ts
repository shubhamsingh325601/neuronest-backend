import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ChildDto } from '@modules/children/shared/child.dto';
import { UpdateChildDto } from './dto/update-child.dto';
import { UpdateChildService } from './update-child.service';

@ApiTags('children')
@Controller({ path: 'children', version: '1' })
export class UpdateChildController {
  constructor(private readonly updateChildService: UpdateChildService) {}

  @Patch(':id')
  @Auth('child:update:self')
  @ApiOkResponse({ type: ChildDto })
  @ApiOperation({
    operationId: 'childUpdate',
    summary:
      "PARENT(own child): update the child's name, date of birth and family-written profile fields.",
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: UpdateChildDto,
  ): Promise<ChildDto> {
    return this.updateChildService.update(id, caller, dto);
  }
}
