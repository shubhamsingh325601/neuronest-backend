import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { AiUsageResponseDto } from './dto/ai-usage.response.dto';
import { GetAiUsageService } from './get-ai-usage.service';

@ApiTags('admin')
@Controller({ path: 'admin/ai/usage', version: '1' })
export class GetAiUsageController {
  constructor(private readonly getAiUsageService: GetAiUsageService) {}

  @Get()
  @Auth('ai-run:read')
  @ApiOkResponse({ type: AiUsageResponseDto })
  @ApiOperation({
    operationId: 'aiUsageGet',
    summary: "Admin: today's AI provider-request usage against the daily budget.",
  })
  get(): Promise<AiUsageResponseDto> {
    return this.getAiUsageService.get();
  }
}
