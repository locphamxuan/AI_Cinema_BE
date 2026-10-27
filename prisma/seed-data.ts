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

/** The legal texts AI labels and the compliance checks refer to (BR-40, BR-42). */
export const SEED_POLICIES = [
  {
    name: 'AI-Generated Content Labeling Policy',
    type: PolicyType.AI_LABELING,
    version: '1.0.0',
    documentReference: 'Điều 44 Luật số 134/2025/QH15 và Điều 18 Nghị định số 142/2026/NĐ-CP',
    content: {
      summary:
        'Mọi nội dung do AI tạo ra hoặc chỉnh sửa khi phát hành cho công chúng phải được ghi nhãn rõ ràng theo Điều 44 Luật số 134/2025/QH15.',
      requirements: [
        'Visible on-screen label on every published episode.',
        'A persistent metadata tag on every catalog item.',
        'Label verification before an episode becomes public.',
        'An audit log of labeling actions.',
      ],
    },
  },
  {
    name: 'Decree 142 Misleading-Content Notice',
    type: PolicyType.LEGAL,
    version: '1.0.0',
    documentReference: 'Nghị định số 142/2026/NĐ-CP',
    content: {
      summary:
        'Nội dung có khả năng gây nhầm lẫn với người thật, sự kiện thật phải kèm thông báo rõ ràng; không mô phỏng người có danh tính thật.',
    },
  },
  {
    name: 'Content Safety Policy',
    type: PolicyType.CONTENT_POLICY,
    version: '1.0.0',
    documentReference: 'Luật An ninh mạng 2018 và quy định nội dung số',
    content: { summary: 'Không bạo lực cực đoan, nội dung khiêu dâm, kích động thù hận hay vi phạm pháp luật.' },
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

/** BR-09: the default reward wheel; the weights are relative chances. */
export const SEED_REWARD_PRIZES: {
  code: string;
  name: string;
  type: RewardPrizeType;
  bonusCoins?: number;
  planDays?: number;
  weight: number;
}[] = [
  { code: 'bonus_20', name: '20 Coin thưởng', type: RewardPrizeType.BONUS_COIN, bonusCoins: 20, weight: 50 },
  { code: 'bonus_50', name: '50 Coin thưởng', type: RewardPrizeType.BONUS_COIN, bonusCoins: 50, weight: 30 },
  { code: 'bonus_100', name: '100 Coin thưởng', type: RewardPrizeType.BONUS_COIN, bonusCoins: 100, weight: 12 },
  { code: 'plan_1_day', name: '1 ngày gói Tháng', type: RewardPrizeType.PLAN_DAYS, planDays: 1, weight: 6 },
  { code: 'plan_3_days', name: '3 ngày gói Tháng', type: RewardPrizeType.PLAN_DAYS, planDays: 3, weight: 2 },
];
