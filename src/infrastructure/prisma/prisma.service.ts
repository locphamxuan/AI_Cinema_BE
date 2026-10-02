import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';

/** The Prisma transaction client handed to a `$transaction(async (tx) => …)` callback. */
export type PrismaTx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    // The adapter owns its pool, so $disconnect() on shutdown also closes every connection.
    super({ adapter: new PrismaPg({ connectionString: config.databaseUrl }) });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
