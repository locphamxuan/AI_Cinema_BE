import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/modules/auth/auth.module';
import { GenreModule } from 'src/modules/genre/genre.module';
import { PolicyModule } from 'src/modules/policy/policy.module';
import { ProductionProjectModule } from 'src/modules/production-project/production-project.module';
import { MilestoneModule } from 'src/modules/milestone/milestone.module';
import { ProductionPlanModule } from 'src/modules/production-plan/production-plan.module';
import { SceneModule } from 'src/modules/scene/scene.module';
import { PlanReviewModule } from 'src/modules/plan-review/plan-review.module';
import { QuotaAllocationModule } from 'src/modules/quota-allocation/quota-allocation.module';
import { GenerationJobModule } from 'src/modules/generation-job/generation-job.module';
import { EpisodePackageModule } from 'src/modules/episode-package/episode-package.module';
import { ReviewModule } from 'src/modules/review/review.module';
import { AiContentLabelModule } from 'src/modules/ai-content-label/ai-content-label.module';
import { ComplianceCheckModule } from 'src/modules/compliance-check/compliance-check.module';
import { UserModule } from 'src/modules/user/user.module';
import { CatalogModule } from 'src/modules/catalog/catalog.module';
import { PublicationModule } from 'src/modules/publication/publication.module';
import { GenreStyleModelModule } from 'src/modules/genre-style-model/genre-style-model.module';
import { ConfigModule } from '@nestjs/config';
import { PaginationModule } from '@nestarc/pagination';

@Module({
  imports: [
    PaginationModule.forRoot({
      defaultLimit: 20,
      maxLimit: 100,
    }),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    GenreModule,
    PolicyModule,
    ProductionProjectModule,
    MilestoneModule,
    ProductionPlanModule,
    SceneModule,
    PlanReviewModule,
    QuotaAllocationModule,
    GenerationJobModule,
    EpisodePackageModule,
    ReviewModule,
    AiContentLabelModule,
    ComplianceCheckModule,
    CatalogModule,
    PublicationModule,
    UserModule,
    GenreStyleModelModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
