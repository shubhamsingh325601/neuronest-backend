import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { GetMeController } from './features/get-me/get-me.controller';
import { GetMeService } from './features/get-me/get-me.service';
import { DeactivateController } from './features/deactivate/deactivate.controller';
import { DeactivateService } from './features/deactivate/deactivate.service';

@Module({
  imports: [AuthModule], // for RefreshTokenService (session revocation)
  controllers: [GetMeController, DeactivateController],
  providers: [GetMeService, DeactivateService],
})
export class UsersModule {}
