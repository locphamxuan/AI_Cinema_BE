import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CompleteSessionRequestDto } from 'src/modules/playback/streaming-session/dto/complete-session.request.dto';
import { HeartbeatRequestDto } from './heart-beat.request.dto';
import { MAX_POSITION_SECONDS } from './position-limit';
import { StopSessionRequestDto } from './stop-session.request.dto';

const refused = async <T extends object>(cls: new () => T, body: object) =>
  (await validate(plainToInstance(cls, body), { whitelist: true })).map((e) => e.property).sort();

describe('playback position requests', () => {
  it('accepts a position inside a day', async () => {
    expect(await refused(HeartbeatRequestDto, { positionSeconds: 320, watchedSeconds: 12 })).toEqual([]);
  });

  it('refuses a position past a day, which would overflow the stored column', async () => {
    const too = MAX_POSITION_SECONDS + 1;
    expect(await refused(HeartbeatRequestDto, { positionSeconds: too, watchedSeconds: too })).toEqual([
      'positionSeconds',
      'watchedSeconds',
    ]);
    expect(await refused(StopSessionRequestDto, { positionSeconds: too })).toContain('positionSeconds');
    expect(await refused(CompleteSessionRequestDto, { positionSeconds: too })).toContain('positionSeconds');
  });
});
