import { articles, money, type ContractDraft } from './contract-clauses';
import { DRAFT } from './template.fixtures';

const article3 = (draft: ContractDraft) => articles(draft).find(([heading]) => heading.startsWith('Điều 3'))![1];

describe('contract clauses', () => {
  it('has the 14 articles and fills in the project and the court place', () => {
    const all = articles(DRAFT);
    expect(all).toHaveLength(14);
    expect(all[0][1][0]).toContain('"Giấc Mơ Số" thể loại Tâm lý, phân loại T13, gồm 2 tập');
    expect(all[12][1][1]).toContain('Thành phố Hồ Chí Minh');
  });

  it('prices the contract the studio receives at the budget ceiling and says so', () => {
    const lines = article3(DRAFT);
    expect(lines[0]).toContain(`${money(200_000_000)}, bằng ngân sách trần`);
    expect(lines[1]).toContain(`Ngân sách trần Bên A dành cho Hợp đồng này là ${money(200_000_000)}`);
    expect(lines.filter((line) => line.includes('Đợt'))).toEqual([
      expect.stringContaining(`Đợt 1: 30% giá trị Hợp đồng, tương đương ${money(60_000_000)}`),
      expect.stringContaining(`Đợt 2: 40% giá trị Hợp đồng, tương đương ${money(80_000_000)}`),
      expect.stringContaining(`Đợt 3: 30% giá trị Hợp đồng, tương đương ${money(60_000_000)}`),
    ]);
  });

  it('states a lower agreed cost with its words, without calling it the ceiling', () => {
    const lines = article3({ ...DRAFT, costVnd: 170_000_000, costInWords: 'Một trăm bảy mươi triệu đồng' });
    expect(lines[0]).toContain(`${money(170_000_000)} (Bằng chữ: Một trăm bảy mươi triệu đồng), là chi phí`);
    expect(lines[0]).not.toContain('bằng ngân sách trần');
  });
});
