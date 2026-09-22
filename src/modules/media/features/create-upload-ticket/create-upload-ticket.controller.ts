import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import { CreateUploadTicketDto } from './dto/create-upload-ticket.dto';
import { CreateUploadTicketResponseDto } from './dto/create-upload-ticket.response.dto';
import { CreateUploadTicketService } from './create-upload-ticket.service';

@ApiTags('media')
@Controller({ path: 'children', version: '1' })
export class CreateUploadTicketController {
  constructor(private readonly createUploadTicketService: CreateUploadTicketService) {}

  @Post(':childId/media/upload-tickets')
  @Auth('media:create:self')
  @ApiCreatedResponse({ type: CreateUploadTicketResponseDto })
  @ApiOperation({
    operationId: 'mediaCreateUploadTicket',
    summary: "Parent: create a signed upload ticket for their own child's media.",
  })
  create(
    @Param('childId', ParseUUIDPipe) childId: string,
    @CurrentUser('id') parentId: string,
    @Body() dto: CreateUploadTicketDto,
  ): Promise<CreateUploadTicketResponseDto> {
    return this.createUploadTicketService.create(childId, parentId, dto);
  }
}
