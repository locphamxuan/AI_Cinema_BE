import { BLANK } from './contract-clauses';
import { PLATFORM, STUDIO } from './template.fixtures';
import { platformParty, studioParty } from './contract-parties';

describe('contract parties', () => {
  it('takes Bên A from the platform settings', () => {
    expect(platformParty(PLATFORM)).toEqual({
      name: 'Công ty TNHH AI Cinema',
      address: 'Thủ Đức',
      taxCode: '0001',
      phone: '028 1',
      email: 'legal@aicinema.vn',
      bankAccount: '0001 - VCB',
      representative: 'Nguyễn Văn An',
      title: 'Giám đốc',
    });
  });

  it('prints a blank for every setting the Admin has not filled in', () => {
    const empty = Object.fromEntries(Object.keys(PLATFORM).map((key) => [key, null])) as unknown as typeof PLATFORM;
    expect(Object.values(platformParty({ ...empty, contractAddress: '   ' }))).toEqual(Array(8).fill(BLANK));
  });

  it('takes Bên B from the studio catalogue, its contact as the representative', () => {
    expect(studioParty(STUDIO)).toEqual({
      name: 'Lumen Studio',
      address: BLANK,
      taxCode: '0002',
      phone: BLANK,
      email: 'studio@lumen.example',
      bankAccount: BLANK,
      representative: 'Nguyễn Thị Lan',
      title: BLANK,
    });
  });
});
