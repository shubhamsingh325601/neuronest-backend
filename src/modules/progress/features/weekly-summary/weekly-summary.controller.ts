import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { WeeklySummaryDto, WeeklySummaryQueryDto } from './dto/weekly-summary.dto';
import { WeeklySummaryService } from './weekly-summary.service';

@ApiTags('progress')
@Controller({ path: 'children', version: '1' })
export class WeeklySummaryController {
  constructor(private readonly weeklySummaryService: WeeklySummaryService) {}

  @Get(':childId/progress/weekly-summary')
  @Auth('progress:read')
  @ApiOkResponse({ type: WeeklySummaryDto })
  @ApiOperation({
    operationId: 'progressWeeklySummary',
    summary:
      'Computed Monday–Sunday progress summary (default: last full week) — parent (own), assigned clinician, or admin.',
  })
  summarise(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: WeeklySummaryQueryDto,
  ): Promise<WeeklySummaryDto> {
    return this.weeklySummaryService.summarise(childId, caller, query);
  }
}
