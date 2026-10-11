import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { ResetExpertPasswordDto } from './dto/reset-expert-password.dto';
import { ResetExpertPasswordService } from './reset-expert-password.service';

@ApiTags('experts')
@Controller({ path: 'experts', version: '1' })
export class ResetExpertPasswordController {
  constructor(private readonly resetExpertPasswordService: ResetExpertPasswordService) {}

  @Post(':id/reset-password')
  @Auth('expert:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Password replaced; the expert is signed out everywhere.' })
  @ApiOperation({
    operationId: 'expertPasswordReset',
    summary: "Admin: set a new password for an expert and end all of the expert's sessions.",
  })
  reset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetExpertPasswordDto,
  ): Promise<void> {
    return this.resetExpertPasswordService.reset(id, dto);
  }
}
