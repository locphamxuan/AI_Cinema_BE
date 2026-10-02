import { Module } from '@nestjs/common';
import { ProductionFeeModule } from 'src/modules/production-fee/production-fee.module';
import { ChangeRequestController } from './change-request.controller';
import { ChangeRequestService } from './change-request.service';
import { IdeaFileController } from './idea-file.controller';
import { IdeaFileService } from './idea-file.service';
import { MovieProjectController } from './movie-project.controller';
import { MovieProjectService } from './movie-project.service';
import { ProjectLifecycleService } from './project-lifecycle.service';
import { ProjectStructureController } from './project-structure.controller';
import { ProjectStructureService } from './project-structure.service';

@Module({
  imports: [ProductionFeeModule],
  controllers: [MovieProjectController, ProjectStructureController, IdeaFileController, ChangeRequestController],
  providers: [
    MovieProjectService,
    ProjectLifecycleService,
    ProjectStructureService,
    IdeaFileService,
    ChangeRequestService,
  ],
  exports: [ProjectLifecycleService],
})
export class MovieProjectModule {}
