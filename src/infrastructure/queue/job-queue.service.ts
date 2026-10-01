import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { type ConnectionOptions, type Job, Queue, Worker } from 'bullmq';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';

export interface JobOptions<T> {
  /** Tries before the job is given up (default 3). */
  attempts?: number;
  /** First retry delay; it doubles on every further retry (default 5 s). */
  backoffMs?: number;
  concurrency?: number;
  /** Runs once the last attempt failed. */
  onFailed?: (data: T, error: Error) => Promise<void>;
}

type Handler<T> = (data: T) => Promise<void>;

interface Registration<T> {
  handler: Handler<T>;
  options: Required<Omit<JobOptions<T>, 'onFailed'>> & Pick<JobOptions<T>, 'onFailed'>;
}

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

const errorOf = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

/**
 * Background jobs. With REDIS_URL set they run on BullMQ workers (retries with exponential
 * backoff, repeatable schedules shared by every API instance). Without Redis a job runs
 * inside the call that adds it and schedules use timers, which keeps development and the
 * test suites free of Redis.
 */
@Injectable()
export class JobQueue implements OnApplicationShutdown {
  private readonly logger = new Logger(JobQueue.name);
  private readonly connection: ConnectionOptions | null;
  private readonly registrations = new Map<string, Registration<unknown>>();
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.connection = config.redisUrl ? connectionOf(config.redisUrl) : null;
  }

  get runsInBackground(): boolean {
    return this.connection !== null;
  }

  register<T>(name: string, handler: Handler<T>, options: JobOptions<T> = {}): void {
    const registration: Registration<T> = {
      handler,
      options: { attempts: 3, backoffMs: 5000, concurrency: 1, ...options },
    };
    this.registrations.set(name, registration);
    if (!this.connection) return;

    const worker = new Worker<T>(name, (job: Job<T>) => handler(job.data), {
      connection: this.connection,
      concurrency: registration.options.concurrency,
    });
    worker.on('failed', (job, error) => {
      if (!job || job.attemptsMade < registration.options.attempts) return;
      this.logger.error(`Job ${name} ${job.id} failed for good: ${error.message}`);
      void registration.options.onFailed?.(job.data, error);
    });
    this.workers.push(worker);
  }

  /** Queues a job; `jobId` makes a repeated add (double click, retry) run it once. */
  async add<T>(name: string, data: T, jobId?: string): Promise<void> {
    const registration = this.registrations.get(name) as Registration<T> | undefined;
    if (!registration) throw new Error(`No handler is registered for job "${name}"`);
    if (this.connection) {
      const { attempts, backoffMs } = registration.options;
      await this.queueOf(name).add(name, data, {
        jobId,
        attempts,
        backoff: { type: 'exponential', delay: backoffMs },
        removeOnComplete: true,
        removeOnFail: 500,
      });
      return;
    }
    await this.runInline(name, registration, data);
  }

  /** Runs `handler` every `intervalMs`; 0 switches the schedule off. */
  async every(name: string, intervalMs: number, handler: () => Promise<void>): Promise<void> {
    if (!(intervalMs > 0)) return;
    if (!this.connection) {
      this.timers.push(setInterval(() => void handler().catch((e) => this.logSchedule(name, e)), intervalMs));
      return;
    }
    this.register(name, handler, { attempts: 1 });
    await this.queueOf(name).upsertJobScheduler(name, { every: intervalMs }, { name, data: {} });
  }

  async onApplicationShutdown(): Promise<void> {
    this.timers.forEach(clearInterval);
    await Promise.all(this.workers.map((worker) => worker.close()));
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }

  private async runInline<T>(name: string, { handler, options }: Registration<T>, data: T): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await handler(data);
        return;
      } catch (error) {
        if (attempt < options.attempts) continue;
        this.logger.error(`Job ${name} failed for good: ${errorOf(error).message}`);
        await options.onFailed?.(data, errorOf(error));
        return;
      }
    }
  }

  private queueOf(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.connection! });
      this.queues.set(name, queue);
    }
    return queue;
  }

  private logSchedule(name: string, error: unknown) {
    this.logger.error(`Scheduled job ${name} failed: ${errorOf(error).message}`);
  }
}
