import { Body, Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import { ChildDto } from '@modules/children/shared/child.dto';
import { CreateChildDto } from './dto/create-child.dto';
import { CreateChildService } from './create-child.service';

@ApiTags('children')
@Controller({ path: 'children', version: '1' })
export class CreateChildController {
  constructor(private readonly createChildService: CreateChildService) {}

  @Post()
  @Auth('child:create:self')
  @ApiCreatedResponse({ type: ChildDto })
  @ApiOperation({
    operationId: 'childCreate',
    summary: 'Parent: create their own child record.',
  })
  create(@CurrentUser('id') parentId: string, @Body() dto: CreateChildDto): Promise<ChildDto> {
    return this.createChildService.create(parentId, dto);
  }
}
