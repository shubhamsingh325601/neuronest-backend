import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { AdminSummaryResponseDto } from './dto/admin-summary.response.dto';
import { GetSummaryService } from './get-summary.service';

@ApiTags('admin')
@Controller({ path: 'admin/summary', version: '1' })
export class GetSummaryController {
  constructor(private readonly getSummaryService: GetSummaryService) {}

  @Get()
  @Auth('admin-summary:read')
  @ApiOkResponse({ type: AdminSummaryResponseDto })
  @ApiOperation({
    operationId: 'adminSummaryGet',
    summary: 'Admin: fixed-shape counts across every domain.',
  })
  get(): Promise<AdminSummaryResponseDto> {
    return this.getSummaryService.get();
  }
}
