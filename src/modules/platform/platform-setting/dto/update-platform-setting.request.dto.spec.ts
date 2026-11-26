import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdatePlatformSettingRequestDto } from './update-platform-setting.request.dto';

const refused = async (body: object) =>
  (await validate(plainToInstance(UpdatePlatformSettingRequestDto, body), { whitelist: true }))
    .map((e) => e.property)
    .sort();

describe('UpdatePlatformSettingRequestDto', () => {
  it('accepts the usual values', async () => {
    const body = { coinRateVnd: 1000, episodeCoinPriceMax: 50, coinTopUpMaxVnd: 2_000_000 };
    expect(await refused(body)).toEqual([]);
  });

  it('caps the amounts below the size of their integer columns', async () => {
    const body = {
      coinRateVnd: 1_000_001,
      episodeCoinPriceMin: 1_000_001,
      episodeCoinPriceMax: 1_000_001,
      playbackHeartbeatTimeoutSeconds: 3_601,
      coinTopUpMinVnd: 1_000_000_001,
      coinTopUpMaxVnd: 3_000_000_000,
    };
    expect(await refused(body)).toEqual(Object.keys(body).sort());
  });
});
