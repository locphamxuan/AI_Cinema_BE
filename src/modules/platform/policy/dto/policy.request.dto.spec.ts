import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePolicyDto } from './create-policy.dto';
import { UpdatePolicyDto } from './update-policy.dto';

const valid = {
  name: 'Chính sách gắn nhãn nội dung AI',
  type: 'AI_LABELING',
  version: '1.0.0',
  content: { requiredLabelText: 'Nội dung do AI tạo', mandatory: true },
};

async function refused<T extends object>(cls: new () => T, body: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, body), { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((e) => e.property);
}

describe('policy requests', () => {
  it('accepts structured content sent as a JSON object, as the web form sends it', async () => {
    expect(await refused(CreatePolicyDto, valid)).toEqual([]);
    expect(await refused(UpdatePolicyDto, { content: valid.content })).toEqual([]);
  });

  it('accepts a PATCH that only switches the policy on or off', async () => {
    expect(await refused(UpdatePolicyDto, { isActive: false })).toEqual([]);
  });

  it('accepts clearing the content and the validity dates with null', async () => {
    expect(await refused(UpdatePolicyDto, { content: null, effectiveFrom: null, effectiveTo: null })).toEqual([]);
  });

  it('refuses content that is not an object, and an isActive that is not a boolean', async () => {
    expect(await refused(CreatePolicyDto, { ...valid, content: '{"a":1}' })).toEqual(['content']);
    expect(await refused(UpdatePolicyDto, { isActive: 'yes' })).toEqual(['isActive']);
  });
});
