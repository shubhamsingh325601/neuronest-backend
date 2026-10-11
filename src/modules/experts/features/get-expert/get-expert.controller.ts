import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { ExpertDetailDto } from '@modules/experts/shared/expert.dto';
import { GetExpertService } from './get-expert.service';

@ApiTags('experts')
@Controller({ path: 'experts', version: '1' })
export class GetExpertController {
  constructor(private readonly getExpertService: GetExpertService) {}

  @Get(':id')
  @Auth('expert:list')
  @ApiOkResponse({ type: ExpertDetailDto })
  @ApiOperation({
    operationId: 'expertGet',
    summary: 'Admin: one expert with lifecycle timestamps and assigned children.',
  })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ExpertDetailDto> {
    return this.getExpertService.get(id);
  }
}
