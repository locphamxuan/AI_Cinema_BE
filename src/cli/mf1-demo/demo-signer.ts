import type { INestApplicationContext } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { ContractTemplateService } from 'src/modules/production/contract/template/contract-template.service';
import { CONTRACT_MARKER, type ContractSide } from 'src/modules/production/contract/template/contract-template-pdf';
import { demoMark } from 'src/modules/production/contract/template/demo-signature';

export const SIGN_DEMO_USAGE = 'Usage: npm run contracts:sign-demo -- <downloaded.pdf> <studio|admin> [output.pdf]';

/** The round a downloaded contract PDF belongs to, read from the keywords the system wrote into it. */
export async function contractIdOf(pdf: Buffer): Promise<string> {
  const keywords = (await PDFDocument.load(pdf, { updateMetadata: false })).getKeywords() ?? '';
  const marker = keywords.split(/\s+/).find((word) => word.startsWith(CONTRACT_MARKER));
  if (!marker) throw new Error('This PDF was not downloaded from AI Cinema: it names no contract');
  return marker.slice(CONTRACT_MARKER.length);
}

/** The Studio signs first; the Admin signs the copy the Studio already signed. */
export function marksFor(side: string): ContractSide[] {
  if (side === 'studio') return ['STUDIO'];
  if (side === 'admin') return ['STUDIO', 'ADMIN'];
  throw new Error('Side must be "studio" or "admin"');
}

export interface Files {
  read: (path: string) => Promise<Buffer>;
  write: (path: string, body: Buffer) => Promise<void>;
}

/**
 * Prepares the demo signing of MF-1: takes the contract PDF just downloaded from Studio Web or the admin web
 * and writes the same contract with the demo signature of one side drawn in, ready to upload. Answers the
 * path it wrote.
 */
export async function signDemoContract(app: INestApplicationContext, args: string[], files: Files): Promise<string> {
  const [input, side, output] = args;
  if (!input || !side) throw new Error(SIGN_DEMO_USAGE);
  const marks = marksFor(side);
  const contractId = await contractIdOf(await files.read(input));
  const signed = await app.get(ContractTemplateService).signedCopy(contractId, marks.map(demoMark));
  const target = output ?? `${input.replace(/\.pdf$/i, '')}-da-ky-${side}.pdf`;
  await files.write(target, signed);
  return target;
}
