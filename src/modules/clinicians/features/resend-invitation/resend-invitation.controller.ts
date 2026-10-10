import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiAcceptedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { ResendInvitationDto } from './dto/resend-invitation.dto';
import { ResendInvitationService } from './resend-invitation.service';

@ApiTags('clinicians')
@Controller({ path: 'clinicians', version: '1' })
export class ResendInvitationController {
  constructor(private readonly resendInvitationService: ResendInvitationService) {}

  @Post(':id/resend-invitation')
  @Auth('clinician:manage')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ description: 'Invitation re-sent; earlier links are invalidated.' })
  @ApiOperation({
    operationId: 'clinicianResendInvitation',
    summary: 'Admin: re-send the setup link to a clinician who has not activated yet.',
  })
  resend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResendInvitationDto = {},
  ): Promise<void> {
    return this.resendInvitationService.resend(id, dto);
  }
}
