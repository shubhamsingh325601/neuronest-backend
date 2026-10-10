import { Module } from '@nestjs/common';
import { RegisterDeviceController } from './features/register-device/register-device.controller';
import { RegisterDeviceService } from './features/register-device/register-device.service';
import { UnregisterDeviceController } from './features/unregister-device/unregister-device.controller';
import { UnregisterDeviceService } from './features/unregister-device/unregister-device.service';

/** Phones that receive push notifications: the app registers its FCM token after sign-in. */
@Module({
  controllers: [RegisterDeviceController, UnregisterDeviceController],
  providers: [RegisterDeviceService, UnregisterDeviceService],
})
export class DevicesModule {}
