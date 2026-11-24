import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SubmitScriptRequestDto } from './script.request.dto';

describe('SubmitScriptRequestDto', () => {
  const refused = async (body: object) =>
    (await validate(plainToInstance(SubmitScriptRequestDto, body))).map((e) => e.property);

  it('refuses a blank script but keeps the text as written', async () => {
    expect(await refused({ content: ' \n\t ' })).toEqual(['content']);
    expect(await refused({ content: '  CẢNH 1\n' })).toEqual([]);
    expect(plainToInstance(SubmitScriptRequestDto, { content: '  CẢNH 1\n' }).content).toBe('  CẢNH 1\n');
  });
});
