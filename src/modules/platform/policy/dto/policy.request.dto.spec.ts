import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePolicyDto } from './create-policy.dto';
import { UpdatePolicyDto } from './update-policy.dto';

const valid = {
  name: '  Quy định gắn nhãn AI  ',
  type: 'AI_LABELING',
  version: '1.0.0',
  content: '  Mọi tập phải gắn nhãn.\n- Nhãn hiện trên màn hình.  ',
};

async function check<T extends object>(cls: new () => T, body: object) {
  const dto = plainToInstance(cls, body);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, refused: errors.map((e) => e.property) };
}

describe('policy requests', () => {
  it('accepts plain text content and trims the title and the text', async () => {
    const { dto, refused } = await check(CreatePolicyDto, valid);
    expect(refused).toEqual([]);
    expect(dto.name).toBe('Quy định gắn nhãn AI');
    expect(dto.content).toBe('Mọi tập phải gắn nhãn.\n- Nhãn hiện trên màn hình.');
  });

  it('requires a title and content, and refuses JSON objects and the dropped types', async () => {
    expect((await check(CreatePolicyDto, { ...valid, name: '   ', content: '  ' })).refused).toEqual([
      'name',
      'content',
    ]);
    expect((await check(CreatePolicyDto, { ...valid, content: { a: 1 } })).refused).toEqual(['content']);
    expect((await check(CreatePolicyDto, { ...valid, type: 'COPYRIGHT' })).refused).toEqual(['type']);
  });

  it('refuses content over 20000 characters', async () => {
    expect((await check(CreatePolicyDto, { ...valid, content: 'a'.repeat(20001) })).refused).toEqual(['content']);
  });

  it('accepts a PATCH that only switches the policy on or off', async () => {
    expect((await check(UpdatePolicyDto, { isActive: false })).refused).toEqual([]);
  });

  it('clears the legal reference and the dates with null or blank, but never the content or title', async () => {
    const cleared = await check(UpdatePolicyDto, { documentReference: '  ', effectiveFrom: null, effectiveTo: null });
    expect(cleared.refused).toEqual([]);
    expect(cleared.dto.documentReference).toBeNull();
    expect((await check(UpdatePolicyDto, { content: null, name: null })).refused).toEqual(['name', 'content']);
  });

  it('refuses an isActive that is not a boolean', async () => {
    expect((await check(UpdatePolicyDto, { isActive: 'yes' })).refused).toEqual(['isActive']);
  });
});
