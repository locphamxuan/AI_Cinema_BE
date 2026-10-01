import { loadConfig } from 'src/config/app-config';
import { JobQueue } from './job-queue.service';

describe('JobQueue without Redis', () => {
  const queue = new JobQueue(loadConfig({ DATABASE_URL: 'postgresql://x/y', JWT_SECRET: 's' }));

  beforeAll(() => jest.spyOn(queue['logger'], 'error').mockImplementation(() => undefined));

  it('runs a job inside the call that adds it', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    queue.register('inline', handler);

    await queue.add('inline', { id: 1 });

    expect(queue.runsInBackground).toBe(false);
    expect(handler).toHaveBeenCalledWith({ id: 1 });
  });

  it('retries a failing job and reports it once every attempt failed', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('boom'));
    const onFailed = jest.fn().mockResolvedValue(undefined);
    queue.register('flaky', handler, { attempts: 3, onFailed });

    await queue.add('flaky', { id: 2 });

    expect(handler).toHaveBeenCalledTimes(3);
    expect(onFailed).toHaveBeenCalledWith({ id: 2 }, new Error('boom'));
  });

  it('stops retrying as soon as an attempt succeeds', async () => {
    const handler = jest.fn().mockRejectedValueOnce(new Error('once')).mockResolvedValue(undefined);
    const onFailed = jest.fn();
    queue.register('recovers', handler, { onFailed });

    await queue.add('recovers', {});

    expect(handler).toHaveBeenCalledTimes(2);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('refuses a job nobody handles', async () => {
    await expect(queue.add('unknown', {})).rejects.toThrow('No handler');
  });

  it('does not schedule anything with a zero interval', async () => {
    const handler = jest.fn();
    await queue.every('off', 0, handler);
    expect(queue['timers']).toHaveLength(0);
  });
});
