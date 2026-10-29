import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminSubscriptionQueryDto } from './admin-subscription.query.dto';

/** Same options as the global ValidationPipe (app.setup.ts). */
const check = (query: Record<string, string>) =>
  validate(plainToInstance(AdminSubscriptionQueryDto, query), { whitelist: true, forbidNonWhitelisted: true });

describe('AdminSubscriptionQueryDto', () => {
  it('lets the page keys through alongside the filters', async () => {
    await expect(check({ page: '1', limit: '20', sortBy: 'createdAt:DESC', status: 'ACTIVE' })).resolves.toEqual([]);
  });

  it('reads an empty filter as no filter', async () => {
    const query = { status: '', planId: '', userId: '', from: '', to: '' };
    await expect(check(query)).resolves.toEqual([]);
    expect(plainToInstance(AdminSubscriptionQueryDto, query).status).toBeUndefined();
  });

  it('still refuses an unknown status or key', async () => {
    expect(await check({ status: 'NOPE' })).toHaveLength(1);
    expect(await check({ planCode: 'x' })).toHaveLength(1);
  });
});
