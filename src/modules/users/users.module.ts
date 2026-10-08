import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { GetMeController } from './features/get-me/get-me.controller';
import { GetMeService } from './features/get-me/get-me.service';
import { DeactivateController } from './features/deactivate/deactivate.controller';
import { DeactivateService } from './features/deactivate/deactivate.service';
import { SuspendUserController } from './features/suspend-user/suspend-user.controller';
import { SuspendUserService } from './features/suspend-user/suspend-user.service';
import { ReactivateUserController } from './features/reactivate-user/reactivate-user.controller';
import { ReactivateUserService } from './features/reactivate-user/reactivate-user.service';
import { ListUsersController } from './features/list-users/list-users.controller';
import { ListUsersService } from './features/list-users/list-users.service';
import { GetUserController } from './features/get-user/get-user.controller';
import { GetUserService } from './features/get-user/get-user.service';
import { UpdateMeController } from './features/update-me/update-me.controller';
import { UpdateMeService } from './features/update-me/update-me.service';
import { GetPreferencesController } from './features/get-preferences/get-preferences.controller';
import { GetPreferencesService } from './features/get-preferences/get-preferences.service';
import { UpdatePreferencesController } from './features/update-preferences/update-preferences.controller';
import { UpdatePreferencesService } from './features/update-preferences/update-preferences.service';

@Module({
  imports: [AuthModule], // for RefreshTokenService (session revocation)
  controllers: [
    GetMeController,
    UpdateMeController,
    GetPreferencesController,
    UpdatePreferencesController,
    DeactivateController,
    SuspendUserController,
    ReactivateUserController,
    ListUsersController,
    // GetUserController's `GET /users/:id` must be registered after `GetMeController`'s
    // literal `GET /users/me` â€” Express tries routes in registration order, and a `:id`
    // pattern would otherwise shadow the static `/me` path.
    GetUserController,
  ],
  providers: [
    GetMeService,
    UpdateMeService,
    GetPreferencesService,
    UpdatePreferencesService,
    DeactivateService,
    SuspendUserService,
    ReactivateUserService,
    ListUsersService,
    GetUserService,
  ],
})
export class UsersModule {}
