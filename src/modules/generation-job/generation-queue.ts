import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { GenerationRunner } from './generation-runner.service';

const QUEUE_NAME = 'generation-jobs';

interface RunJobData {
  jobId: string;
}
const DEFAULT_CONCURRENCY = 2;

function connectionOf(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    // Required by BullMQ workers: a blocked command must wait for Redis, not fail.
    maxRetriesPerRequest: null,
  };
}

/**
 * Where a generation job runs. With REDIS_URL set, `run` only enqueues the job and a
 * BullMQ worker generates it in the background (a video takes 15–60 s), so the request
 * returns at once and the client polls the job. Without Redis the job runs inline,
 * which keeps local development and the test suites dependency-free.
 */
@Injectable()
export class GenerationQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GenerationQueue.name);
  private readonly redisUrl: string | undefined;
  private queue: Queue<RunJobData> | null = null;
  private worker: Worker<RunJobData> | null = null;

  constructor(
    private readonly runner: GenerationRunner,
    private readonly config: ConfigService,
  ) {
    this.redisUrl = config.get<string>('REDIS_URL') || undefined;
  }

  /** True when `enqueue` returns before the job has been generated. */
  get isBackground(): boolean {
    return this.redisUrl !== undefined;
  }

  onModuleInit() {
    if (!this.redisUrl) return;
    const connection = connectionOf(this.redisUrl);
    this.queue = new Queue<RunJobData>(QUEUE_NAME, { connection });
    this.worker = new Worker<RunJobData>(QUEUE_NAME, (job) => this.runner.execute(job.data.jobId), {
      connection,
      concurrency: Number(this.config.get<string>('GENERATION_CONCURRENCY') ?? DEFAULT_CONCURRENCY),
    });
    this.worker.on('failed', (job, error) =>
      this.logger.error(`Generation job ${job?.data.jobId} crashed: ${error.message}`),
    );
    this.logger.log(`Generation jobs run in the background (BullMQ queue "${QUEUE_NAME}")`);
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  /** Runs the job in the caller, bypassing the queue (subtitles for an assembled cut). */
  runNow(jobId: string) {
    return this.runner.execute(jobId);
  }

  /** Runs the job now and returns it, or queues it for the worker and returns null. */
  async enqueue(jobId: string) {
    if (!this.queue) return this.runner.execute(jobId);
    // The BullMQ job id is the generation job id, so a double click queues it once.
    await this.queue.add('run', { jobId }, { jobId, removeOnComplete: true, removeOnFail: 100 });
    return null;
  }
}
