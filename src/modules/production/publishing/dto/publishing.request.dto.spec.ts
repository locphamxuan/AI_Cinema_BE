import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PublishEpisodeRequestDto, RequestPriceChangeRequestDto, UnpublishRequestDto } from './publishing.request.dto';

async function refused<T extends object>(cls: new () => T, body: object) {
  return (await validate(plainToInstance(cls, body))).map((e) => e.property);
}

describe('publishing requests', () => {
  it('schedules only at a moment with its UTC offset', async () => {
    for (const ok of ['2099-11-20T20:00:00+07:00', '2099-11-20T13:00:00.000Z', '2099-11-20T13:00Z']) {
      expect(await refused(PublishEpisodeRequestDto, { scheduledAt: ok })).toEqual([]);
    }
    for (const ambiguous of ['2099-11-20', '2099-11-20T20:00:00']) {
      expect(await refused(PublishEpisodeRequestDto, { scheduledAt: ambiguous })).toEqual(['scheduledAt']);
    }
  });

  it('refuses a blank take-down note or price question', async () => {
    expect(await refused(UnpublishRequestDto, { reason: 'MANUAL', note: '      ' })).toEqual(['note']);
    expect(await refused(RequestPriceChangeRequestDto, { note: '      ' })).toEqual(['note']);
  });
});
