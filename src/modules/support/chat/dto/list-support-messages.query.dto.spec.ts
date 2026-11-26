import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListSupportMessagesQueryDto } from './list-support-messages.query.dto';

async function refused(query: object): Promise<string[]> {
  const errors = await validate(plainToInstance(ListSupportMessagesQueryDto, query), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

describe('ListSupportMessagesQueryDto', () => {
  it('accepts no cursor, or an ISO cursor with a size', async () => {
    expect(await refused({})).toEqual([]);
    expect(await refused({ before: '2026-11-23T08:00:00.000Z', limit: '50' })).toEqual([]);
  });

  it.each(['abc', '2026-13-40', ''])('refuses the cursor %p', async (before) => {
    expect(await refused({ before })).toEqual(['before']);
  });

  it.each(['abc', '0', '101', '2.5'])('refuses the size %p', async (limit) => {
    expect(await refused({ limit })).toEqual(['limit']);
  });
});
