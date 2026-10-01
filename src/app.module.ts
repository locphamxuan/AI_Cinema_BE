import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PaginationModule } from '@nestarc/pagination';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { AppConfigModule } from 'src/config/config.module';
import { MailerModule } from 'src/infrastructure/mailer/mailer.module';
import { PrismaModule } from 'src/infrastructure/prisma/prisma.module';
import { QueueModule } from 'src/infrastructure/queue/queue.module';
import { StorageModule } from 'src/infrastructure/storage/storage.module';
import { AuditLogModule } from 'src/modules/audit-log/audit-log.module';
import { AuthModule } from 'src/modules/auth/auth.module';
import { EmailModule } from 'src/modules/email/email.module';
import { GenreModule } from 'src/modules/genre/genre.module';
import { MediaIngestModule } from 'src/modules/media-ingest/media-ingest.module';
import { MovieProjectModule } from 'src/modules/movie-project/movie-project.module';
import { NotificationModule } from 'src/modules/notification/notification.module';
import { PolicyModule } from 'src/modules/policy/policy.module';
import { ProjectAccessModule } from 'src/modules/project-access/project-access.module';
import { StudioHandoffModule } from 'src/modules/studio-handoff/studio-handoff.module';
import { PlatformSettingModule } from 'src/modules/platform-setting/platform-setting.module';
import { UserModule } from 'src/modules/user/user.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => [{ ttl: config.rateLimit.ttlMs, limit: config.rateLimit.limit }],
    }),
    PaginationModule.forRoot({ defaultLimit: 20, maxLimit: 100 }),
    PrismaModule,
    StorageModule,
    QueueModule,
    MailerModule,
    AuthModule,
    NotificationModule,
    EmailModule,
    AuditLogModule,
    GenreModule,
    PolicyModule,
    PlatformSettingModule,
    UserModule,
    ProjectAccessModule,
    MovieProjectModule,
    StudioHandoffModule,
    MediaIngestModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
