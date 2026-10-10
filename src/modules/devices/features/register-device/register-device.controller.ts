import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@common/authz/auth.decorator';
import { CurrentUser } from '@common/authz/current-user.decorator';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { RegisterDeviceService } from './register-device.service';

@ApiTags('devices')
@Controller({ path: 'devices', version: '1' })
export class RegisterDeviceController {
  constructor(private readonly registerDeviceService: RegisterDeviceService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('user:update:self')
  @ApiNoContentResponse({
    description: 'The device now receives push notifications for this user.',
  })
  @ApiOperation({
    operationId: 'devicesRegister',
    summary: "Register the signed-in user's phone for push notifications.",
  })
  register(@CurrentUser('id') userId: string, @Body() dto: RegisterDeviceDto): Promise<void> {
    return this.registerDeviceService.register(userId, dto);
  }
}
