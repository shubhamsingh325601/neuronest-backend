import { Body, Controller, Param, Put, Res } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import type { AuthenticatedUser } from '@common/authz/jwt-payload.type';
import { ProgressEntryDto } from '@modules/progress/shared/progress.dto';
import { UpsertProgressDto, UpsertProgressParamsDto } from './dto/upsert-progress.dto';
import { UpsertProgressService } from './upsert-progress.service';

@ApiTags('progress')
@Controller({ path: 'children', version: '1' })
export class UpsertProgressController {
  constructor(private readonly upsertProgressService: UpsertProgressService) {}

  @Put(':childId/progress/:entryDate')
  @Auth('progress:write:self')
  @ApiCreatedResponse({ type: ProgressEntryDto, description: 'Entry created.' })
  @ApiOkResponse({ type: ProgressEntryDto, description: 'Existing entry replaced.' })
  @ApiOperation({
    operationId: 'progressUpsert',
    summary: "PARENT(own child): log or replace a day's mood/behaviour/sleep (idempotent).",
  })
  async upsert(
    @Param() params: UpsertProgressParamsDto,
    @CurrentUser() caller: AuthenticatedUser,
    @Body() dto: UpsertProgressDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProgressEntryDto> {
    const { created, entry } = await this.upsertProgressService.upsert(
      params.childId,
      params.entryDate,
      caller,
      dto,
    );
    res.status(created ? 201 : 200);
    return entry;
  }
}
