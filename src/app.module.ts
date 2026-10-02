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
import { AuditLogModule } from 'src/modules/platform/audit-log/audit-log.module';
import { AuthModule } from 'src/modules/identity/auth/auth.module';
import { CatalogModule } from 'src/modules/catalog/catalog.module';
import { ContentReviewModule } from 'src/modules/production/content-review/content-review.module';
import { EmailModule } from 'src/modules/platform/email/email.module';
import { GenreModule } from 'src/modules/platform/genre/genre.module';
import { MediaIngestModule } from 'src/modules/production/media-ingest/media-ingest.module';
import { MovieProjectModule } from 'src/modules/production/movie-project/movie-project.module';
import { NotificationModule } from 'src/modules/platform/notification/notification.module';
import { PublishingModule } from 'src/modules/production/publishing/publishing.module';
import { PolicyModule } from 'src/modules/platform/policy/policy.module';
import { ProjectAccessModule } from 'src/modules/production/project-access/project-access.module';
import { StudioHandoffModule } from 'src/modules/production/studio-handoff/studio-handoff.module';
import { StudioPortalModule } from 'src/modules/production/studio-portal/studio-portal.module';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { UserModule } from 'src/modules/identity/user/user.module';
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
    StudioPortalModule,
    ContentReviewModule,
    PublishingModule,
    CatalogModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
