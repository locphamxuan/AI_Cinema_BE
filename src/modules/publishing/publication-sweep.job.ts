import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';
import { PublicationService } from './publication.service';

/** Step 14 for scheduled releases: publishes every release whose time has come. */
@Injectable()
export class PublicationSweepJob implements OnModuleInit {
  constructor(
    private readonly queue: JobQueue,
    private readonly publications: PublicationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    return this.queue.every('publications.due', this.config.schedules.publicationSweepMs, () =>
      this.publications.publishDue().then(() => undefined),
    );
  }
}
