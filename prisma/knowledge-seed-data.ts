import type { KnowledgeSource, SupportAudience } from '@prisma/client';
import { BILLING_ARTICLES } from './knowledge-seed-billing';
import { VIEWING_ARTICLES } from './knowledge-seed-viewing';

export interface SeedArticle {
  slug: string;
  title: string;
  category: string;
  audience: SupportAudience;
  source: KnowledgeSource;
  markdown: string;
}

/**
 * The Vietnamese support FAQ. Keep it in line with the current business rules: VNPay only, monthly
 * plan only, no whole-series purchase, main Coins spent before bonus Coins, bonus Coins never
 * expire. A migration that corrects stored articles must copy the same text.
 */
export const SEED_ARTICLES: SeedArticle[] = [...BILLING_ARTICLES, ...VIEWING_ARTICLES];
