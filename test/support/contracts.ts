import { PDFDocument } from 'pdf-lib';
import type { Actor, Row } from './api';

/** A small but genuine PDF standing in for a scan of the signed contract. */
export async function signedPdf(label: string, pages = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([320, 200]).drawText(`${label} ${i + 1}`, { x: 20, y: 100, size: 12 });
  return Buffer.from(await doc.save());
}

const file = (content: Buffer, name = 'hop-dong-da-ky.pdf') => ({ field: 'file', name, content });

/** Studio: fills the cost into the template and uploads its signed counterpart. */
export async function proposeCost(studio: Actor, contractId: string, costVnd: number, status = 200): Promise<Row> {
  const pdf = await signedPdf('Ban ky cua Studio');
  return studio.upload(
    `/studio-portal/contracts/${contractId}/propose`,
    file(pdf),
    { costVnd: String(costVnd) },
    status,
  );
}

/** Admin: uploads the AI Cinema counterpart, completing the round. */
export async function adminSign(admin: Actor, contractId: string, status = 200): Promise<Row> {
  const pdf = await signedPdf('Ban ky cua AI Cinema', 2);
  return admin.upload(`/contracts/${contractId}/sign`, file(pdf), {}, status);
}

/** Admin: proposes another cost with the counterpart signed for it, opening a new round. */
export async function adminCounter(admin: Actor, contractId: string, costVnd: number, status = 200): Promise<Row> {
  const pdf = await signedPdf('Ban ky cua AI Cinema');
  return admin.upload(`/contracts/${contractId}/counter`, file(pdf), { costVnd: String(costVnd) }, status);
}

/** Studio: signs the Admin's counter, completing the round. */
export async function studioSign(studio: Actor, contractId: string, status = 200): Promise<Row> {
  const pdf = await signedPdf('Ban ky cua Studio');
  return studio.upload(`/studio-portal/contracts/${contractId}/sign`, file(pdf), {}, status);
}

/** Studio: answers the Admin's counter with another cost and its own signed counterpart. */
export async function studioCounter(studio: Actor, contractId: string, costVnd: number, status = 200): Promise<Row> {
  const pdf = await signedPdf('Ban ky cua Studio');
  return studio.upload(
    `/studio-portal/contracts/${contractId}/counter`,
    file(pdf),
    { costVnd: String(costVnd) },
    status,
  );
}
