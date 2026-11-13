import { BadRequestException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import {
  assertUsableCounterpart,
  MAX_CONTRACT_PAGES,
  mergeSignedCounterparts,
  type SignedSummary,
} from './contract-pdf';

async function pdfWith(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([300, 300]);
  return Buffer.from(await doc.save());
}

const SUMMARY: SignedSummary = {
  contractId: '9f2b4c6e-0000-4000-8000-000000000001',
  round: 2,
  movieTitle: 'Giấc Mơ Số',
  studioName: 'Lumen Studio',
  costVnd: 170_000_000n,
  adminName: 'Nguyễn Văn A',
  adminSignedAt: new Date('2026-11-10T03:00:00.000Z'),
  studioSignedAt: new Date('2026-11-10T04:30:00.000Z'),
};

describe('contract PDF merge', () => {
  it('builds one document holding both counterparts and the closing page', async () => {
    const admin = await pdfWith(2);
    const studio = await pdfWith(3);

    const merged = await mergeSignedCounterparts({ admin, studio }, SUMMARY, null);
    const read = await PDFDocument.load(merged, { updateMetadata: false });

    // 2 Admin pages + 3 studio pages + the page the system draws with both signature blocks.
    expect(read.getPageCount()).toBe(6);
    expect(read.getTitle()).toContain(SUMMARY.contractId);
    expect(read.getCreationDate()).toEqual(SUMMARY.adminSignedAt);
    expect(read.getModificationDate()).toEqual(SUMMARY.studioSignedAt);
  });

  it('is deterministic: the same counterparts always merge into the same bytes', async () => {
    const admin = await pdfWith(1);
    const studio = await pdfWith(1);
    const first = await mergeSignedCounterparts({ admin, studio }, SUMMARY, null);
    const second = await mergeSignedCounterparts({ admin, studio }, SUMMARY, null);
    expect(first.equals(second)).toBe(true);
  });

  it('refuses anything that is not a readable PDF', async () => {
    await expect(assertUsableCounterpart(Buffer.from('%PDF-1.7 broken'), 'Admin')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(assertUsableCounterpart(Buffer.alloc(0), 'Studio')).rejects.toThrow(/cannot be read|no pages/);
  });

  it('refuses a counterpart longer than a contract ever is', async () => {
    const long = await pdfWith(MAX_CONTRACT_PAGES + 1);
    await expect(assertUsableCounterpart(long, 'Studio')).rejects.toThrow(/at most 40/);
    await expect(assertUsableCounterpart(await pdfWith(1), 'Studio')).resolves.toBe(1);
  });
});
