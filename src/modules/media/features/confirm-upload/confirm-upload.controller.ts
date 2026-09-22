import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import { MediaDto } from '@modules/media/shared/media.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { ConfirmUploadService } from './confirm-upload.service';

@ApiTags('media')
@Controller({ path: 'media', version: '1' })
export class ConfirmUploadController {
  constructor(private readonly confirmUploadService: ConfirmUploadService) {}

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @Auth('media:create:self')
  @ApiOkResponse({ type: MediaDto })
  @ApiOperation({
    operationId: 'mediaConfirmUpload',
    summary: 'Parent: report the outcome of a direct-to-provider upload.',
  })
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') parentId: string,
    @Body() dto: ConfirmUploadDto,
  ): Promise<MediaDto> {
    return this.confirmUploadService.confirm(id, parentId, dto);
  }
}
