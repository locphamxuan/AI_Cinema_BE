import { PolicyType, UserRole } from '@prisma/client';

/** Development accounts; all of them sign in with SEED_USER_PASSWORD. */
export const SEED_USERS: { email: string; fullName: string; role: UserRole; dateOfBirth?: Date }[] = [
  ...[
    'Nguyễn Minh Anh',
    'Trần Quốc Bảo',
    'Lê Hoàng Nam',
    'Phạm Gia Huy',
    'Võ Thành Đạt',
    'Đặng Nhật Minh',
    'Bùi Đức Anh',
    'Ngô Tuấn Kiệt',
  ].map((fullName, i) => ({
    email: `creator0${i + 1}@aicinema.com`,
    fullName,
    role: UserRole.CONTENT_CREATOR,
  })),
  ...['Nguyễn Thu Hà', 'Trần Ngọc Linh', 'Lê Thanh Hương', 'Phạm Khánh Vy', 'Vũ Minh Trang', 'Đỗ Hoàng Long'].map(
    (fullName, i) => ({ email: `reviewer0${i + 1}@aicinema.com`, fullName, role: UserRole.CONTENT_REVIEWER }),
  ),
  { email: 'staff01@aicinema.com', fullName: 'Nguyễn Văn Thành', role: UserRole.STAFF },
  { email: 'admin@aicinema.com', fullName: 'AI Cinema Admin', role: UserRole.ADMIN },
  {
    email: 'member01@aicinema.com',
    fullName: 'Nguyễn Hoàng Anh',
    role: UserRole.MEMBER,
    dateOfBirth: new Date('2002-08-15'),
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
