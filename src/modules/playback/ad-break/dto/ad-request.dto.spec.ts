import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MAX_AD_WEIGHT } from '../ad-limits';
import { CreateAdRequestDto } from './create-ad.request.dto';
import { UpdateAdRequestDto } from './update-ad.request.dto';

const base = { title: 'Ad', mediaUrl: 'https://cdn.example/a.mp4' };

/** The properties the validation pipe would reject, as the API answers them. */
async function invalidProperties(type: new () => object, value: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(type, value));
  return errors.map((error) => error.property);
}

describe('ad request bounds (P4-6)', () => {
  it('rejects a weight above the ceiling and accepts the ceiling itself', async () => {
    await expect(invalidProperties(CreateAdRequestDto, { ...base, weight: MAX_AD_WEIGHT + 1 })).resolves.toEqual([
      'weight',
    ]);
    await expect(invalidProperties(CreateAdRequestDto, { ...base, weight: MAX_AD_WEIGHT })).resolves.toEqual([]);
    await expect(invalidProperties(UpdateAdRequestDto, { weight: MAX_AD_WEIGHT + 1 })).resolves.toEqual(['weight']);
  });

  it('takes a video served by the API itself (local storage has no TLD)', async () => {
    await expect(
      invalidProperties(CreateAdRequestDto, { ...base, mediaUrl: 'http://localhost:3001/media/public/ads/a.mp4' }),
    ).resolves.toEqual([]);
  });
});
