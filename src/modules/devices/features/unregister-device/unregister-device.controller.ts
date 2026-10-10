import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import { UnregisterDeviceDto } from './dto/unregister-device.dto';
import { UnregisterDeviceService } from './unregister-device.service';

@ApiTags('devices')
@Controller({ path: 'devices', version: '1' })
export class UnregisterDeviceController {
  constructor(private readonly unregisterDeviceService: UnregisterDeviceService) {}

  // An action sub-path, not DELETE /devices/:token, so the token stays out of URLs and access logs.
  @Post('unregister')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('user:update:self')
  @ApiNoContentResponse({
    description: 'The device no longer receives push notifications for this user.',
  })
  @ApiOperation({
    operationId: 'devicesUnregister',
    summary: "Stop push notifications to one of the signed-in user's phones.",
  })
  unregister(@CurrentUser('id') userId: string, @Body() dto: UnregisterDeviceDto): Promise<void> {
    return this.unregisterDeviceService.unregister(userId, dto);
  }
}
