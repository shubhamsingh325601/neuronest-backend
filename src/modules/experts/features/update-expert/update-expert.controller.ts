import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { ExpertDetailDto } from '@modules/experts/shared/expert.dto';
import { UpdateExpertDto } from '@modules/experts/shared/update-expert.dto';
import { UpdateExpertService } from './update-expert.service';

@ApiTags('experts')
@Controller({ path: 'experts', version: '1' })
export class UpdateExpertController {
  constructor(private readonly updateExpertService: UpdateExpertService) {}

  @Patch(':id')
  @Auth('expert:manage')
  @ApiOkResponse({ type: ExpertDetailDto })
  @ApiOperation({
    operationId: 'expertUpdate',
    summary: 'Admin: update the name or sign-in email of an expert.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpertDto,
  ): Promise<ExpertDetailDto> {
    return this.updateExpertService.update(id, dto);
  }
}
