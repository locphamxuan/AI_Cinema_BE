import { Global, Module } from '@nestjs/common';
import { JobQueue } from './job-queue.service';

@Global()
@Module({ providers: [JobQueue], exports: [JobQueue] })
export class QueueModule {}
