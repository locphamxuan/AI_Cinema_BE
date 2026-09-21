import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, PolicyType, UserRole } from '@prisma/client';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const adapter = new PrismaPg(new Pool({ connectionString }));
const prisma = new PrismaClient({ adapter });

const users = [
  // CONTENT CREATORS
  {
    email: 'creator01@aicinema.com',
    passwordHash: '$2b$10$dummy.hash.creator01',
    fullName: 'Nguyễn Minh Anh',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator02@aicinema.com',
    passwordHash: '$2b$10$dummy.hash.creator02',
    fullName: 'Trần Quốc Bảo',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator03@aicinema.com',
    passwordHash: '$2b$10$dummy.hash.creator03',
    fullName: 'Lê Hoàng Nam',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator04@aicinema.com',
    passwordHash: '$2b$10$dummy.hash.creator04',
    fullName: 'Phạm Gia Huy',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator05@aicinema.com',
    passwordHash: '$2b$10$dummy.hash.creator05',
    fullName: 'Võ Thành Đạt',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator06@aicinema.com',
    passwordHash: '$2b$10$dummy.hash.creator06',
    fullName: 'Đặng Nhật Minh',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator07@aicinema.com',
    passwordHash: '$2b$10$dummy.hash.creator07',
    fullName: 'Bùi Đức Anh',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator08@aicinema.com',
    passwordHash: '$2b$10$dummy.hash.creator08',
    fullName: 'Ngô Tuấn Kiệt',
    role: UserRole.CONTENT_CREATOR,
  },

  // CONTENT REVIEWERS
  {
    email: 'reviewer01@aicinema.com',
    passwordHash: '$2b$10$dummy.hash.reviewer01',
    fullName: 'Nguyễn Thu Hà',
    role: UserRole.CONTENT_REVIEWER,
  },
  {
    email: 'reviewer02@aicinema.com',
    passwordHash: '$2b$10$dummy.hash.reviewer02',
    fullName: 'Trần Ngọc Linh',
    role: UserRole.CONTENT_REVIEWER,
  },
  {
    email: 'reviewer03@aicinema.com',
    passwordHash: '$2b$10$dummy.hash.reviewer03',
    fullName: 'Lê Thanh Hương',
    role: UserRole.CONTENT_REVIEWER,
  },
  {
    email: 'reviewer04@aicinema.com',
    passwordHash: '$2b$10$dummy.hash.reviewer04',
    fullName: 'Phạm Khánh Vy',
    role: UserRole.CONTENT_REVIEWER,
  },
  {
    email: 'reviewer05@aicinema.com',
    passwordHash: '$2b$10$dummy.hash.reviewer05',
    fullName: 'Vũ Minh Trang',
    role: UserRole.CONTENT_REVIEWER,
  },
  {
    email: 'reviewer06@aicinema.com',
    passwordHash: '$2b$10$dummy.hash.reviewer06',
    fullName: 'Đỗ Hoàng Long',
    role: UserRole.CONTENT_REVIEWER,
  },

  // STAFF / ADMIN / MEMBER
  {
    email: 'staff01@aicinema.com',
    passwordHash: '$2b$10$dummy.hash.staff01',
    fullName: 'Nguyễn Văn Thành',
    role: UserRole.STAFF,
  },
  {
    email: 'admin@aicinema.com',
    passwordHash: '$2b$10$dummy.hash.admin',
    fullName: 'AI Cinema Admin',
    role: UserRole.ADMIN,
  },
  {
    email: 'member01@aicinema.com',
    passwordHash: '$2b$10$dummy.hash.member01',
    fullName: 'Nguyễn Hoàng Anh',
    role: UserRole.MEMBER,
  },
];

const genres = [
  {
    name: 'Hành động',
    description: 'Phim nổi bật với các màn chiến đấu, truy đuổi, pha hành động và những tình huống kịch tính.',
  },
  {
    name: 'Phiêu lưu',
    description: 'Phim xoay quanh những chuyến hành trình, khám phá và các cuộc phiêu lưu đầy thử thách.',
  },
  {
    name: 'Hài',
    description: 'Phim tập trung vào sự hài hước, các tình huống vui nhộn và nhằm mang lại tiếng cười cho khán giả.',
  },
  {
    name: 'Tội phạm',
    description:
      'Phim xoay quanh tội phạm, điều tra, cảnh sát, các băng nhóm và những xung đột liên quan đến pháp luật.',
  },
  {
    name: 'Chính kịch',
    description: 'Phim tập trung vào cảm xúc, tâm lý nhân vật và những xung đột trong cuộc sống.',
  },
  {
    name: 'Gia đình',
    description: 'Phim phù hợp với nhiều độ tuổi, thường xoay quanh gia đình, tình cảm và các giá trị nhân văn.',
  },
  {
    name: 'Giả tưởng',
    description: 'Phim lấy bối cảnh trong những thế giới phép thuật, sinh vật huyền bí hoặc các hiện tượng siêu nhiên.',
  },
  {
    name: 'Kinh dị',
    description: 'Phim tạo cảm giác sợ hãi, bất an và căng thẳng thông qua các yếu tố kinh dị hoặc siêu nhiên.',
  },
  {
    name: 'Bí ẩn',
    description: 'Phim xoay quanh những bí mật, vụ án hoặc sự kiện khó giải thích được hé lộ dần trong câu chuyện.',
  },
  {
    name: 'Lãng mạn',
    description: 'Phim tập trung vào tình yêu, các mối quan hệ và hành trình cảm xúc của nhân vật.',
  },
  {
    name: 'Khoa học viễn tưởng',
    description: 'Phim khai thác khoa học, công nghệ tương lai, trí tuệ nhân tạo, không gian hoặc những thực tại khác.',
  },
  {
    name: 'Giật gân',
    description:
      'Phim tạo ra sự hồi hộp và căng thẳng thông qua những tình tiết bất ngờ, nguy hiểm và các bước ngoặt trong cốt truyện.',
  },
  {
    name: 'Tâm lý',
    description: 'Phim tập trung vào suy nghĩ, cảm xúc, hành vi và những biến chuyển tâm lý phức tạp của nhân vật.',
  },
  {
    name: 'Lịch sử',
    description: 'Phim lấy cảm hứng từ hoặc tái hiện các sự kiện, nhân vật và giai đoạn lịch sử.',
  },
  {
    name: 'Tài liệu',
    description: 'Phim phi hư cấu trình bày con người, sự kiện, hiện tượng hoặc những câu chuyện có thật.',
  },
  {
    name: 'Thể thao',
    description: 'Phim xoay quanh vận động viên, các cuộc thi, quá trình luyện tập và hành trình theo đuổi thành tích.',
  },
  {
    name: 'Chiến tranh',
    description: 'Phim mô tả các cuộc chiến, xung đột vũ trang và ảnh hưởng của chiến tranh đến con người.',
  },
  {
    name: 'Miền Tây',
    description:
      'Phim lấy bối cảnh miền Tây nước Mỹ, thường có cao bồi, thị trấn biên giới, kẻ ngoài vòng pháp luật và những cuộc đấu súng.',
  },
  {
    name: 'Nhạc kịch',
    description: 'Phim kết hợp âm nhạc, ca hát và vũ đạo trực tiếp vào quá trình kể chuyện.',
  },
];

const aiLabelingPolicy = {
  name: 'AI-Generated Content Labeling Policy',
  type: PolicyType.AI_LABELING,
  version: '1.0.0',
  documentReference: 'Điều 44 Luật số 134/2025/QH15 và Điều 18 Nghị định số 142/2026/NĐ-CP',
  content: {
    summary:
      'Mọi nội dung do AI tạo ra hoặc chỉnh sửa khi phát hành cho công chúng phải được ghi nhãn rõ ràng và niêm yết theo yêu cầu của Điều 44 Luật số 134/2025/QH15 và Điều 18 Nghị định số 142/2026/NĐ-CP.',
    requirements: [
      'Visible on-screen label identifying the content as AI-generated or AI-edited on every published episode.',
      'A persistent metadata tag marking AI-generated or AI-edited content for all catalog items.',
      'Label verification before any movie becomes publicly viewable.',
      'An audit log of labeling actions for regulatory reporting.',
    ],
  },
  effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
  effectiveTo: null,
  isActive: true,
};

async function main() {
  for (const genre of genres) {
    await prisma.genre.upsert({
      where: { name: genre.name },
      update: { description: genre.description },
      create: genre,
    });
  }

  const existingPolicy = await prisma.policy.findFirst({
    where: { documentReference: aiLabelingPolicy.documentReference },
  });

  if (existingPolicy) {
    await prisma.policy.update({
      where: { id: existingPolicy.id },
      data: {
        name: aiLabelingPolicy.name,
        type: aiLabelingPolicy.type,
        version: aiLabelingPolicy.version,
        content: aiLabelingPolicy.content,
        effectiveFrom: aiLabelingPolicy.effectiveFrom,
        effectiveTo: aiLabelingPolicy.effectiveTo,
        isActive: aiLabelingPolicy.isActive,
      },
    });
  } else {
    await prisma.policy.create({
      data: aiLabelingPolicy,
    });
  }

  for (const user of users) {
    await prisma.user.upsert({
      where: {
        email: user.email,
      },
      update: {
        fullName: user.fullName,
        role: user.role,
        isActive: true,
      },
      create: {
        email: user.email,
        passwordHash: user.passwordHash,
        fullName: user.fullName,
        role: user.role,
        isActive: true,
      },
    });
  }

  console.log('Seeded genres, users and AI labeling policy.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
