import { Module } from '@nestjs/common';
import { PublicationController } from './publication.controller';
import { PublicationScheduler } from './publication.scheduler';
import { PublicationService } from './publication.service';

@Module({
  controllers: [PublicationController],
  providers: [PublicationService, PublicationScheduler],
})
export class PublicationModule {}
