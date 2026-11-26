import { PolicyType, RewardPrizeType, UserRole } from '@prisma/client';
import type { SeedAccount } from './seed-accounts';

/** The platform's four accounts; a new one signs in with SEED_USER_PASSWORD until its owner changes it. */
export const ADMIN_EMAIL = 'admin@gmail.com';
export const SEED_ACCOUNTS: SeedAccount[] = [
  { email: ADMIN_EMAIL, fullName: 'Quản trị viên AI Cinema', role: UserRole.ADMIN },
  { email: 'reviewer@gmail.com', fullName: 'Reviewer AI Cinema', role: UserRole.CONTENT_REVIEWER },
  { email: 'creator.aicinema@gmail.com', fullName: 'Creator AI Cinema', role: UserRole.CONTENT_CREATOR },
  {
    email: 'abc@gmail.com',
    fullName: 'Thành viên AI Cinema',
    role: UserRole.MEMBER,
    dateOfBirth: new Date('2003-05-14'),
  },
];

/** The rules the Reviewer follows when labelling and checking a version (BR-40, BR-42), as plain text. */
export const SEED_POLICIES = [
  {
    name: 'Quy định gắn nhãn nội dung do AI tạo',
    type: PolicyType.AI_LABELING,
    version: '1.0.0',
    documentReference: 'Điều 44 Luật số 134/2025/QH15 và Điều 18 Nghị định số 142/2026/NĐ-CP',
    content: [
      'Mọi tập phim có phần do AI tạo hoặc chỉnh sửa phải được gắn nhãn rõ ràng khi phát cho người xem (Điều 44 Luật số 134/2025/QH15).',
      '- Nhãn hiện trên màn hình ở mọi tập đã phát hành.',
      '- Thông tin phim trong danh mục luôn ghi rõ là nội dung do AI tạo.',
      '- Reviewer kiểm tra nhãn trước khi tập được công khai.',
      '- Mọi lần gắn hoặc đổi nhãn đều được ghi lại.',
    ].join('\n'),
  },
  {
    name: 'Thông báo theo Nghị định 142 và người, sự kiện có thật',
    type: PolicyType.LEGAL,
    version: '1.0.0',
    documentReference: 'Nghị định số 142/2026/NĐ-CP',
    content: [
      'Nội dung dễ khiến người xem nhầm với người thật hoặc sự kiện thật phải kèm thông báo rõ ràng (Nghị định số 142/2026/NĐ-CP).',
      '- Không mô phỏng người có danh tính thật.',
      '- Nếu tập có chi tiết dễ gây hiểu nhầm, ghi rõ chỗ đó khi kiểm tra.',
    ].join('\n'),
  },
  {
    name: 'Quy định an toàn nội dung',
    type: PolicyType.CONTENT_POLICY,
    version: '1.0.0',
    documentReference: 'Luật An ninh mạng 2018 và quy định nội dung số',
    content: [
      'Tập phim không được chứa:',
      '- Bạo lực cực đoan.',
      '- Nội dung khiêu dâm.',
      '- Lời lẽ kích động thù hận.',
      '- Nội dung vi phạm pháp luật.',
    ].join('\n'),
  },
];

/** BR-05/BR-09: the default check-in ladder (bonus Coins only); day 7 is the spin milestone. */
export const SEED_REWARD_RULES = [5, 5, 10, 10, 15, 15, 30].map((bonusCoins, index) => ({
  code: `streak_day_${index + 1}`,
  name: `Ngày thứ ${index + 1} trong chuỗi`,
  streakDay: index + 1,
  bonusCoins,
  grantsSpin: index === 6,
}));

/** BR-09: the default reward wheel; each weight is a chance in basis points and they add up to 10 000 (100 %). */
export const SEED_REWARD_PRIZES: {
  code: string;
  name: string;
  type: RewardPrizeType;
  bonusCoins?: number;
  planDays?: number;
  weight: number;
}[] = [
  { code: 'bonus_20', name: '20 Coin thưởng', type: RewardPrizeType.BONUS_COIN, bonusCoins: 20, weight: 5000 },
  { code: 'bonus_50', name: '50 Coin thưởng', type: RewardPrizeType.BONUS_COIN, bonusCoins: 50, weight: 3000 },
  { code: 'bonus_100', name: '100 Coin thưởng', type: RewardPrizeType.BONUS_COIN, bonusCoins: 100, weight: 1200 },
  { code: 'plan_1_day', name: '1 ngày gói Tháng', type: RewardPrizeType.PLAN_DAYS, planDays: 1, weight: 600 },
  { code: 'plan_3_days', name: '3 ngày gói Tháng', type: RewardPrizeType.PLAN_DAYS, planDays: 3, weight: 200 },
];

/** The demo Staff login (support inbox): its own password, not SEED_USER_PASSWORD. */
export const SEED_STAFF_ACCOUNT = {
  email: 'staff@gmail.com',
  fullName: 'Nhân viên hỗ trợ AI Cinema',
  role: UserRole.STAFF,
};
export const SEED_STAFF_PASSWORD = process.env.SEED_STAFF_PASSWORD ?? 'Staff123456';
