import { Module } from '@nestjs/common';
import { ProductionCostModule } from 'src/modules/production/production-cost/production-cost.module';
import { StudioModule } from 'src/modules/production/studio/studio.module';
import { ArtworkController } from './artwork/artwork.controller';
import { ArtworkService } from './artwork/artwork.service';
import { ChangeRequestController } from './change-request/change-request.controller';
import { ChangeRequestService } from './change-request/change-request.service';
import { EpisodeNoteController } from './episode-note/episode-note.controller';
import { EpisodeNoteService } from './episode-note/episode-note.service';
import { IdeaFileController } from './idea-file/idea-file.controller';
import { IdeaFileService } from './idea-file/idea-file.service';
import { MovieProjectController } from './movie-project.controller';
import { MovieProjectService } from './movie-project.service';
import { ProjectLifecycleService } from './project-lifecycle.service';
import { ProjectPipelineService } from './project-pipeline.service';
import { ProjectNoteController } from './project-note/project-note.controller';
import { ProjectNoteService } from './project-note/project-note.service';
import { ProjectStructureController } from './structure/project-structure.controller';
import { ProjectStructureService } from './structure/project-structure.service';
import { ProjectTeamController } from './team/project-team.controller';
import { ProjectTeamService } from './team/project-team.service';

@Module({
  imports: [ProductionCostModule, StudioModule],
  controllers: [
    MovieProjectController,
    ProjectStructureController,
    ProjectTeamController,
    ArtworkController,
    IdeaFileController,
    ChangeRequestController,
    EpisodeNoteController,
    ProjectNoteController,
  ],
  providers: [
    MovieProjectService,
    ProjectLifecycleService,
    ProjectPipelineService,
    ProjectStructureService,
    ProjectTeamService,
    ArtworkService,
    IdeaFileService,
    ChangeRequestService,
    EpisodeNoteService,
    ProjectNoteService,
  ],
  exports: [ProjectLifecycleService],
})
export class MovieProjectModule {}
