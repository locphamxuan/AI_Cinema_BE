import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { JWT_ALGORITHM } from 'src/common/auth/authenticated-user';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { AccessControlModule } from 'src/modules/identity/access-control/access-control.module';
import { PermissionsGuard } from 'src/modules/identity/access-control/permissions.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionTokenService } from './session-token.service';

@Global()
@Module({
  imports: [
    AccessControlModule,
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwt.secret,
        signOptions: { algorithm: JWT_ALGORITHM },
        verifyOptions: { algorithms: [JWT_ALGORITHM] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionTokenService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [SessionTokenService],
})
export class AuthModule {}
