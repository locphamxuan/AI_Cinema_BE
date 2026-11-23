import { pngImage } from 'src/modules/production/contract/template/template.fixtures';
import type { Actor, Row } from './api';

/** A genuine PNG standing in for the picture of a signature (MF-1, 22/11/2026). */
export const SIGNATURE_PNG = pngImage(300, 100);

const file = (content: Buffer = SIGNATURE_PNG, name = 'chu-ky.png') => ({ field: 'file', name, content });

/** A legal profile that passes every check, as the studio fills it in on Studio Web. */
export const LEGAL_PROFILE = {
  address: '12 Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh',
  taxCode: '0312345678',
  bankAccount: '0123456789',
  bankName: 'Ngân hàng TMCP Á Châu',
  representativeTitle: 'Giám đốc',
};

/** Studio: signs the contract with its signature image at a cost. */
export async function proposeCost(studio: Actor, contractId: string, costVnd: number, status = 200): Promise<Row> {
  return studio.upload(`/studio-portal/contracts/${contractId}/propose`, file(), { costVnd: String(costVnd) }, status);
}

/** Admin: signs the round the studio signed with AI Cinema's signature image, completing it. */
export async function adminSign(admin: Actor, contractId: string, status = 200): Promise<Row> {
  return admin.upload(`/contracts/${contractId}/sign`, file(), {}, status);
}

/** Admin: signs the contract for another cost, opening a new round. */
export async function adminCounter(admin: Actor, contractId: string, costVnd: number, status = 200): Promise<Row> {
  return admin.upload(`/contracts/${contractId}/counter`, file(), { costVnd: String(costVnd) }, status);
}

/** Studio: signs the Admin's counter, completing the round. */
export async function studioSign(studio: Actor, contractId: string, status = 200): Promise<Row> {
  return studio.upload(`/studio-portal/contracts/${contractId}/sign`, file(), {}, status);
}

/** Studio: answers the Admin's counter with another cost and its signature. */
export async function studioCounter(studio: Actor, contractId: string, costVnd: number, status = 200): Promise<Row> {
  return studio.upload(`/studio-portal/contracts/${contractId}/counter`, file(), { costVnd: String(costVnd) }, status);
}
