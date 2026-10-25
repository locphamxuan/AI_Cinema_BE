import { Module } from '@nestjs/common';
import { ProductionFeeModule } from 'src/modules/production/production-fee/production-fee.module';
import { ReviewerTokenModule } from 'src/modules/production/reviewer-token/reviewer-token.module';
import { StudioModule } from 'src/modules/production/studio/studio.module';
import { ArtworkController } from './artwork/artwork.controller';
import { ArtworkService } from './artwork/artwork.service';
import { ChangeRequestController } from './change-request/change-request.controller';
import { ChangeRequestService } from './change-request/change-request.service';
import { IdeaFileController } from './idea-file/idea-file.controller';
import { IdeaFileService } from './idea-file/idea-file.service';
import { MovieProjectController } from './movie-project.controller';
import { MovieProjectService } from './movie-project.service';
import { ProjectLifecycleService } from './project-lifecycle.service';
import { ProjectStructureController } from './structure/project-structure.controller';
import { ProjectStructureService } from './structure/project-structure.service';
import { ProjectTeamController } from './team/project-team.controller';
import { ProjectTeamService } from './team/project-team.service';

@Module({
  imports: [ProductionFeeModule, ReviewerTokenModule, StudioModule],
  controllers: [
    MovieProjectController,
    ProjectStructureController,
    ProjectTeamController,
    ArtworkController,
    IdeaFileController,
    ChangeRequestController,
  ],
  providers: [
    MovieProjectService,
    ProjectLifecycleService,
    ProjectStructureService,
    ProjectTeamService,
    ArtworkService,
    IdeaFileService,
    ChangeRequestService,
  ],
  exports: [ProjectLifecycleService],
})
export class MovieProjectModule {}
