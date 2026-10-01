import { complianceVerdicts } from './compliance.service';
import { durationCheck } from './content-review.service';
import type { RunComplianceRequestDto } from './dto/content-review.request.dto';

const committed = { aiDisclosure: { noRealPersonLikeness: true }, label: { labelText: 'Phim do AI tạo ra' } };
const allClear: RunComplianceRequestDto = {
  decree142Notice: { result: 'PASS' },
  contentSafety: { result: 'PASS' },
  depictsRealPersonOrEvent: false,
};
const resultOf = (verdicts: ReturnType<typeof complianceVerdicts>, type: string) =>
  verdicts.find((v) => v.checkType === type)!;

describe('Compliance items (BR-42)', () => {
  it('passes all four when the label is there and nothing is misleading', () => {
    const verdicts = complianceVerdicts(committed, allClear);
    expect(verdicts.map((v) => [v.checkType, v.result])).toEqual([
      ['AI_LABEL_PRESENCE', 'PASS'],
      ['DECREE_142_NOTICE', 'PASS'],
      ['CONTENT_SAFETY', 'PASS'],
      ['REAL_PERSON_LIKENESS', 'PASS'],
    ]);
    expect(verdicts.every((v) => v.failureReason === null)).toBe(true);
  });

  it('fails the label item when the version has no label, whatever the Reviewer says', () => {
    const verdict = resultOf(complianceVerdicts({ ...committed, label: null }, allClear), 'AI_LABEL_PRESENCE');
    expect(verdict).toMatchObject({ result: 'FAIL', failureReason: 'The version has no AI label' });
  });

  it('fails the real-person item when the Reviewer saw a misleading depiction', () => {
    const verdict = resultOf(
      complianceVerdicts(committed, { ...allClear, depictsRealPersonOrEvent: true, realPersonNote: 'Giống ca sĩ X' }),
      'REAL_PERSON_LIKENESS',
    );
    expect(verdict).toMatchObject({ result: 'FAIL', failureReason: 'Giống ca sĩ X' });
  });

  it('fails the real-person item when the studio never committed, even if the Reviewer saw nothing', () => {
    const verdict = resultOf(complianceVerdicts({ ...committed, aiDisclosure: {} }, allClear), 'REAL_PERSON_LIKENESS');
    expect(verdict.result).toBe('FAIL');
    expect(verdict.failureReason).toContain('did not commit');
  });

  it("keeps the Reviewer's reason for a failed item", () => {
    const verdict = resultOf(
      complianceVerdicts(committed, {
        ...allClear,
        contentSafety: { result: 'FAIL', failureReason: ' Bạo lực quá mức ' },
      }),
      'CONTENT_SAFETY',
    );
    expect(verdict).toMatchObject({ result: 'FAIL', failureReason: 'Bạo lực quá mức' });
  });
});

describe('Episode length check (BR-31)', () => {
  it('warns only beyond 20% of the target, in either direction', () => {
    expect(durationCheck(600, 700)).toMatchObject({ deviationSeconds: 100, warning: false });
    expect(durationCheck(600, 721)).toMatchObject({ deviationSeconds: 121, warning: true });
    expect(durationCheck(600, 470)).toMatchObject({ deviationSeconds: -130, warning: true });
  });

  it('cannot judge a version whose length is unknown', () => {
    expect(durationCheck(600, null)).toEqual({
      targetSeconds: 600,
      actualSeconds: null,
      deviationSeconds: null,
      warning: false,
    });
  });
});
