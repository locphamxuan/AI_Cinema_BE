import { Prisma, type SupportKnowledgeArticle } from '@prisma/client';

/** The article columns every admin listing and response returns; the markdown stays out of them. */
export const SUMMARY_COLUMNS = [
  'id',
  'title',
  'slug',
  'category',
  'audience',
  'locale',
  'status',
  'source',
  'sourceRef',
  'version',
  'contentHash',
  'indexStatus',
  'indexError',
  'indexedAt',
  'createdAt',
  'updatedAt',
] as const satisfies readonly (keyof SupportKnowledgeArticle)[];

export const SUMMARY_SELECT = Object.fromEntries(
  SUMMARY_COLUMNS.map((column) => [column, true]),
) as Prisma.SupportKnowledgeArticleSelect;
