import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from 'src/common/decorators/public.decorator';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { JobQueue } from 'src/infrastructure/queue/job-queue.service';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueue,
  ) {}

  /**
   * Liveness and readiness probe: answers 503 while the database is unreachable. Redis is only
   * reported: without it deliveries cannot be queued, but everything else still works.
   */
  @Public()
  @SkipThrottle()
  @Get('health')
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('The database is unreachable');
    }
    return { status: 'ok', database: 'up', redis: await this.queue.redisStatus() };
  }
}
