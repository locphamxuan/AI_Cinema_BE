import { execSync } from 'node:child_process';
import { E2E_DATABASE_URL } from './e2e-env';

/**
 * Brings the e2e database up to the latest migration and seeds it. Both steps are
 * idempotent and never drop data: a clean slate comes from `npm run test:e2e:db:down`
 * (the container keeps its data in tmpfs), and each run uses its own unique names.
 */
export default function globalSetup() {
  const run = (command: string) =>
    execSync(command, { stdio: 'inherit', env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL } });

  run('npx prisma migrate deploy');
  run('npx prisma db seed');
}
