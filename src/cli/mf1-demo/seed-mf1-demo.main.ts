import 'dotenv/config';
// Background jobs and outgoing mail stay off while the demo is built: no sweeps, no real email to the studio.
process.env.REDIS_URL = '';
process.env.SMTP_HOST = '';
process.env.MEDIA_PIPELINE = 'mock';
for (const job of ['PUBLICATION_SWEEP_MS', 'OVERDUE_SWEEP_MS', 'HLS_CHECK_MS', 'STREAMING_SESSION_SWEEP_MS']) {
  process.env[job] = '0';
}
process.env.STREAMING_SESSION_RETENTION_SWEEP_MS = '0';
process.env.SUPPORT_AUTO_CLOSE_SWEEP_MS = '0';

import { NestFactory } from '@nestjs/core';
import { AppModule } from 'src/app.module';
import { seedMf1Demo } from './mf1-demo-seeder';

/** npm run seed:mf1-demo (builds first: Nest DI needs decorator metadata, which tsx does not emit). */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    console.log(await seedMf1Demo(app));
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
