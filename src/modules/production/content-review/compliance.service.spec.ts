import { ComplianceService, complianceVerdicts } from './compliance.service';
import { ContentReviewService } from './content-review.service';
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

describe('ComplianceService.run', () => {
  it('refuses a second run once the first one moved the episode on, recording no verdict', async () => {
    const tx = {
      episode: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      complianceCheck: { upsert: jest.fn() },
      aiContentLabel: { findUnique: jest.fn() },
    };
    const asset = {
      id: 'a1',
      episodeId: 'e1',
      ingestStatus: 'READY',
      episode: { status: 'LABELED', approvedMediaAssetId: 'a1', project: { status: 'IN_PRODUCTION' } },
    };
    const reviews = new ContentReviewService({} as never, {} as never, {} as never, {} as never, {} as never);
    const service = new ComplianceService(
      { $transaction: jest.fn((work: (db: unknown) => Promise<unknown>) => work(tx)) } as never,
      { mediaAsset: jest.fn().mockResolvedValue(asset) } as never,
      reviews,
      { record: jest.fn() } as never,
      { notify: jest.fn() } as never,
    );
    await expect(service.run('a1', allClear, { id: 'rev' } as never)).rejects.toMatchObject({
      response: { details: { reason: 'CHANGED_MEANWHILE' } },
    });
    expect(tx.episode.updateMany).toHaveBeenCalledWith({
      where: { id: 'e1', status: 'LABELED', approvedMediaAssetId: 'a1' },
      data: { status: 'LABELED' },
    });
    expect(tx.complianceCheck.upsert).not.toHaveBeenCalled();
  });
});
