import { Injectable } from '@nestjs/common';

export type SupportIntent = 'answer' | 'tool' | 'escalate' | 'resolve';

/**
 * Cheap pre-filter of plan §5.4: a direct staff request escalates before the LLM is asked.
 * Matching ignores Vietnamese diacritics, so "huy goi" and "hủy gói" reach the same branch.
 */
@Injectable()
export class IntentRouterService {
  route(content: string): SupportIntent {
    const lower = normalize(content);

    if (STAFF_REQUEST.some((keyword) => lower.includes(keyword))) return 'escalate';
    if (RESOLVE.some((keyword) => lower.includes(keyword))) return 'resolve';
    if (NEEDS_ACCOUNT_DATA.some((keyword) => lower.includes(keyword))) return 'tool';
    return 'answer';
  }
}

const STAFF_REQUEST = [
  'nhan vien',
  'nguoi that',
  'gap staff',
  'gap nhan vien',
  'khieu nai',
  'bao cao su co',
  'lien he ho tro',
].map(normalize);

const RESOLVE = ['da giai quyet', 'da xong', 'khong can ho tro nua', 'cam on da giup'].map(normalize);

const NEEDS_ACCOUNT_DATA = [
  'so du',
  'coin',
  'goi',
  'subscription',
  'quyen xem',
  'thanh toan',
  'giao dich',
  'thiet bi',
  'phien xem',
  'mo khoa',
].map(normalize);

/** Lowercase, strip tone marks and map đ → d; `NFD` splits a letter from its combining mark. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}
