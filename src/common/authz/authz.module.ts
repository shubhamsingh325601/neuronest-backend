import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccessTokenService } from './access-token.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';

/**
 * Wires JWT signing/verification and exposes the auth guards + access-token issuer.
 * The guards are registered globally as APP_GUARD in AppModule (order matters there);
 * this module only provides them.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [AccessTokenService, JwtAuthGuard, PermissionsGuard],
  exports: [AccessTokenService, JwtAuthGuard, PermissionsGuard, JwtModule],
})
export class AuthzModule {}
