import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PaginationModule } from '@nestarc/pagination';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/modules/auth/auth.module';
import { GenreModule } from 'src/modules/genre/genre.module';
import { PolicyModule } from 'src/modules/policy/policy.module';
import { PlatformSettingModule } from 'src/modules/platform-setting/platform-setting.module';
import { UserModule } from 'src/modules/user/user.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    PaginationModule.forRoot({ defaultLimit: 20, maxLimit: 100 }),
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    GenreModule,
    PolicyModule,
    PlatformSettingModule,
    UserModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
