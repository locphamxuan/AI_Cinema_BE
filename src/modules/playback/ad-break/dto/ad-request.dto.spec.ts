import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAdRequestDto } from './create-ad.request.dto';
import { UpdateAdRequestDto } from './update-ad.request.dto';

const base = { title: 'Ad', mediaUrl: 'https://cdn.example/a.mp4' };

/** The properties the validation pipe would reject, as the API answers them. */
async function invalidProperties(type: new () => object, value: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(type, value));
  return errors.map((error) => error.property);
}

describe('ad request bounds', () => {
  it('refuses a blank title and trims the one it keeps', async () => {
    await expect(invalidProperties(CreateAdRequestDto, { ...base, title: '   ' })).resolves.toEqual(['title']);
    await expect(invalidProperties(UpdateAdRequestDto, { title: '' })).resolves.toEqual(['title']);
    expect(plainToInstance(CreateAdRequestDto, { ...base, title: '  Gong Cha  ' }).title).toBe('Gong Cha');
  });

  it('refuses the removed click-through link and pick weight fields', async () => {
    const errors = await validate(
      plainToInstance(CreateAdRequestDto, { ...base, clickUrl: 'https://x.example', weight: 2 }),
      {
        whitelist: true,
        forbidNonWhitelisted: true,
      },
    );
    expect(errors.map((error) => error.property).sort()).toEqual(['clickUrl', 'weight']);
  });

  it('takes a video served by the API itself (local storage has no TLD)', async () => {
    await expect(
      invalidProperties(CreateAdRequestDto, { ...base, mediaUrl: 'http://localhost:3001/media/public/ads/a.mp4' }),
    ).resolves.toEqual([]);
  });
});
