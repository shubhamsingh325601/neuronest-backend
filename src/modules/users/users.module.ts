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

@Module({
  imports: [AuthModule], // for RefreshTokenService (session revocation)
  controllers: [
    GetMeController,
    DeactivateController,
    SuspendUserController,
    ReactivateUserController,
    ListUsersController,
    // GetUserController's `GET /users/:id` must be registered after `GetMeController`'s
    // literal `GET /users/me` — Express tries routes in registration order, and a `:id`
    // pattern would otherwise shadow the static `/me` path.
    GetUserController,
  ],
  providers: [
    GetMeService,
    DeactivateService,
    SuspendUserService,
    ReactivateUserService,
    ListUsersService,
    GetUserService,
  ],
})
export class UsersModule {}
