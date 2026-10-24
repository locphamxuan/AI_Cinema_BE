import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MAX_AD_DURATION_SECONDS, MAX_AD_WEIGHT } from '../ad-limits';
import { CreateAdRequestDto } from './create-ad.request.dto';
import { UpdateAdRequestDto } from './update-ad.request.dto';

const base = { title: 'Ad', mediaUrl: 'https://cdn.example/a.mp4', durationSeconds: 15 };

/** The properties the validation pipe would reject, as the API answers them. */
async function invalidProperties(type: new () => object, value: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(type, value));
  return errors.map((error) => error.property);
}

describe('ad request bounds (P4-6)', () => {
  it('rejects a duration or weight above the ceiling on create', async () => {
    await expect(
      invalidProperties(CreateAdRequestDto, { ...base, durationSeconds: MAX_AD_DURATION_SECONDS + 1 }),
    ).resolves.toEqual(['durationSeconds']);
    await expect(invalidProperties(CreateAdRequestDto, { ...base, weight: MAX_AD_WEIGHT + 1 })).resolves.toEqual([
      'weight',
    ]);
  });

  it('accepts the ceilings themselves', async () => {
    await expect(
      invalidProperties(CreateAdRequestDto, {
        ...base,
        durationSeconds: MAX_AD_DURATION_SECONDS,
        weight: MAX_AD_WEIGHT,
      }),
    ).resolves.toEqual([]);
  });

  it('applies the same ceilings to a partial update', async () => {
    await expect(
      invalidProperties(UpdateAdRequestDto, { durationSeconds: MAX_AD_DURATION_SECONDS + 1 }),
    ).resolves.toEqual(['durationSeconds']);
    await expect(invalidProperties(UpdateAdRequestDto, { weight: MAX_AD_WEIGHT + 1 })).resolves.toEqual(['weight']);
    await expect(
      invalidProperties(UpdateAdRequestDto, {
        durationSeconds: MAX_AD_DURATION_SECONDS,
        weight: MAX_AD_WEIGHT,
      }),
    ).resolves.toEqual([]);
  });
});
