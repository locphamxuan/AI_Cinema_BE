import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApplyAiLabelRequestDto, ReviewMediaRequestDto, RunComplianceRequestDto } from './content-review.request.dto';

async function refused<T extends object>(cls: new () => T, body: object) {
  return (await validate(plainToInstance(cls, body))).map((e) => e.property);
}

describe('content-review requests', () => {
  it('needs real feedback when changes are requested, not five spaces', async () => {
    expect(await refused(ReviewMediaRequestDto, { decision: 'CHANGES_REQUESTED', comments: '       ' })).toEqual([
      'comments',
    ]);
    expect(await refused(ReviewMediaRequestDto, { decision: 'CHANGES_REQUESTED' })).toEqual(['comments']);
    expect(await refused(ReviewMediaRequestDto, { decision: 'CHANGES_REQUESTED', comments: 'Sửa cảnh 3' })).toEqual([]);
  });

  it('takes a short comment on an approval but still checks its type and length', async () => {
    expect(await refused(ReviewMediaRequestDto, { decision: 'APPROVED' })).toEqual([]);
    expect(await refused(ReviewMediaRequestDto, { decision: 'APPROVED', comments: 'Ok' })).toEqual([]);
    expect(await refused(ReviewMediaRequestDto, { decision: 'APPROVED', comments: 42 })).toEqual(['comments']);
    expect(await refused(ReviewMediaRequestDto, { decision: 'APPROVED', comments: 'x'.repeat(5001) })).toEqual([
      'comments',
    ]);
  });

  it('refuses a blank AI label text and blank failure reasons', async () => {
    expect(await refused(ApplyAiLabelRequestDto, { labelType: 'AI_GENERATED', labelText: '      ' })).toEqual([
      'labelText',
    ]);
    const failed = await refused(RunComplianceRequestDto, {
      decree142Notice: { result: 'FAIL', failureReason: '      ' },
      contentSafety: { result: 'PASS' },
      depictsRealPersonOrEvent: true,
      realPersonNote: '      ',
    });
    expect(failed.sort()).toEqual(['decree142Notice', 'realPersonNote']);
  });
});
