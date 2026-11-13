import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { RequestActorInterceptor } from 'src/common/http/request-actor';
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
import { OAuthModule } from 'src/modules/identity/oauth/oauth.module';
import { CatalogModule } from 'src/modules/catalog/catalog.module';
import { EpisodeAccessModule } from 'src/modules/episode-access/episode-access.module';
import { PlaybackModule } from 'src/modules/playback/playback.module';
import { SupportModule } from 'src/modules/support/support.module';
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
import { StudioModule } from 'src/modules/production/studio/studio.module';
import { CostRequestModule } from 'src/modules/production/cost-request/cost-request.module';
import { ContractModule } from 'src/modules/production/contract/contract.module';
import { ScriptModule } from 'src/modules/production/script/script.module';
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
    // After AuthModule: its scope guard must run after the JWT and permission guards.
    OAuthModule,
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
    StudioModule,
    CostRequestModule,
    ContractModule,
    ScriptModule,
    StudioPortalModule,
    ContentReviewModule,
    PublishingModule,
    CatalogModule,
    EpisodeAccessModule,
    PlaybackModule,
    SupportModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestActorInterceptor },
  ],
})
export class AppModule {}
