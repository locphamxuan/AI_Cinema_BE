import 'dotenv/config';
// Only the database is needed: no queue, no mail.
process.env.REDIS_URL = '';
process.env.SMTP_HOST = '';

import { readFile, writeFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { AppModule } from 'src/app.module';
import { signDemoContract } from './demo-signer';

/** npm run contracts:sign-demo -- <downloaded.pdf> <studio|admin> [output.pdf] */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const target = await signDemoContract(app, process.argv.slice(2), { read: readFile, write: writeFile });
    console.log(`${target}: upload it as the signed contract.`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
