import { Body, Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CreateExpertDto } from '@modules/experts/shared/create-expert.dto';
import { ExpertDetailDto } from '@modules/experts/shared/expert.dto';
import { CreateExpertService } from './create-expert.service';

@ApiTags('experts')
@Controller({ path: 'experts', version: '1' })
export class CreateExpertController {
  constructor(private readonly createExpertService: CreateExpertService) {}

  @Post()
  @Auth('expert:manage')
  @ApiCreatedResponse({ type: ExpertDetailDto })
  @ApiOperation({
    operationId: 'expertCreate',
    summary: 'Admin: create an ACTIVE expert with an initial password (no invitation).',
  })
  create(@Body() dto: CreateExpertDto): Promise<ExpertDetailDto> {
    return this.createExpertService.create(dto);
  }
}
