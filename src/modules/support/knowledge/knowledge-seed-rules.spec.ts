import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEED_ARTICLES } from '../../../../prisma/knowledge-seed-data';

const MIGRATION = join(
  __dirname,
  '../../../../prisma/migrations/20261122130000_support_knowledge_current_rules/migration.sql',
);

/** Phrases of rules that no longer hold; none may come back into the seeded FAQ. */
const STALE_PHRASES = [
  /hạn dùng/i,
  /coin thưởng (sắp |đã |sẽ )?hết hạn(?! không)/i,
  /(?<!không có )momo/i,
  /theo tuần, tháng hoặc năm/i,
  /liên kết đặt lại mật khẩu/i,
  /hoàn lại số Coin đã trả bằng Coin chính/i,
];

describe('Seeded support knowledge follows the current business rules', () => {
  const allText = SEED_ARTICLES.map((article) => `${article.title}\n${article.markdown}`).join('\n');

  it.each(STALE_PHRASES)('never says %s', (phrase) => {
    expect(allText).not.toMatch(phrase);
  });

  it('says bonus Coins never expire and are spent after main Coins', () => {
    const coin = SEED_ARTICLES.find((article) => article.slug === 'coin-main-va-coin-thuong')!;
    expect(coin.markdown).toContain('Coin thưởng đều không hết hạn');
    expect(coin.markdown).toContain('trừ Coin chính trước');
  });

  it('keeps slugs unique', () => {
    expect(new Set(SEED_ARTICLES.map((article) => article.slug)).size).toBe(SEED_ARTICLES.length);
  });

  it('ships the same text in the migration that corrects stored articles', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    for (const article of SEED_ARTICLES) {
      expect(sql).toContain(`"slug" = '${article.slug}'`);
      expect(sql).toContain(`$kb$${article.markdown}$kb$`);
      expect(sql).toContain(`$kb$${article.title}$kb$`);
      expect(sql).toContain(`"category" = $kb$${article.category}$kb$`);
    }
  });
});
