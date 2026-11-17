import { articles, BLANK, money, type ContractDraft } from './contract-clauses';
import { PLATFORM_PARTY, studioParty } from './contract-parties';

const DRAFT: ContractDraft = {
  contractNo: 'AIC-1',
  day: '17 tháng 11 năm 2026',
  place: 'Thành phố Hồ Chí Minh',
  movieTitle: 'Giấc Mơ Số',
  genre: 'Tâm lý',
  ageRating: 'T13',
  episodes: [{ number: 1, title: 'Khởi động', minutes: 12, dueDate: '25/11/2026' }],
  costVnd: null,
  budgetVnd: 200_000_000,
  partyA: PLATFORM_PARTY,
  partyB: studioParty({ name: 'Lumen', email: 'studio@lumen.example', phone: null, contactName: null }),
};

const article3 = (draft: ContractDraft) => articles(draft).find(([heading]) => heading.startsWith('Điều 3'))![1];

describe('contract clauses', () => {
  it('has the 14 articles and fills in the project and the court place', () => {
    const all = articles(DRAFT);
    expect(all).toHaveLength(14);
    expect(all[0][1][0]).toContain('"Giấc Mơ Số" thể loại Tâm lý, phân loại T13, gồm 1 tập');
    expect(all[12][1][1]).toContain('Thành phố Hồ Chí Minh');
  });

  it('leaves the cost blank on the unsigned template but states the budget ceiling', () => {
    const lines = article3(DRAFT);
    expect(lines[0]).toContain(BLANK);
    expect(lines[1]).toContain(`Ngân sách trần Bên A dành cho Hợp đồng này là ${money(200_000_000)}`);
    expect(lines.filter((line) => line.includes('Đợt'))).toEqual([
      expect.stringContaining('Đợt 1: 30%'),
      expect.stringContaining('Đợt 2: 40%'),
      expect.stringContaining('Đợt 3: 30%'),
    ]);
    expect(lines.join(' ')).not.toContain('tương đương');
  });

  it('states the agreed cost, its words and each instalment once priced', () => {
    const lines = article3({ ...DRAFT, costVnd: 170_000_000, costInWords: 'Một trăm bảy mươi triệu đồng' });
    expect(lines[0]).toContain(`${money(170_000_000)} (Bằng chữ: Một trăm bảy mươi triệu đồng)`);
    expect(lines.join(' ')).toContain(`tương đương ${money(51_000_000)}`);
    expect(article3({ ...DRAFT, costVnd: 1_000 })[0]).not.toContain('Bằng chữ');
  });

  it('takes Bên B from the studio and leaves what the platform does not keep blank', () => {
    expect(DRAFT.partyB).toMatchObject({
      name: 'Lumen',
      email: 'studio@lumen.example',
      phone: BLANK,
      representative: BLANK,
    });
    expect(studioParty({ name: 'L', email: 'e', phone: '028', contactName: 'Bình' })).toMatchObject({
      phone: '028',
      representative: 'Bình',
      taxCode: BLANK,
    });
  });
});
