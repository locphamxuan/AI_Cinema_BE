import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, PolicyType, UserRole } from '@prisma/client';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import { AI_MODEL_CATALOG } from '../src/modules/ai-model/ai-model-catalog';
import { GENRE_CATALOG, genreStyleTriggerKeyword } from './genre-catalog';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const adapter = new PrismaPg(new Pool({ connectionString }));
const prisma = new PrismaClient({ adapter });

// Every seeded staff account signs in with this password (development only);
// public sign-up can only create viewers, so these are the MF-1 actors.
const SEED_USER_PASSWORD = process.env.SEED_USER_PASSWORD ?? 'Aicinema@123';
// Placeholder hashes an earlier seed stored; they are replaced so the account can sign in.
const PLACEHOLDER_HASH_PREFIX = '$2b$10$dummy';

const users = [
  // CONTENT CREATORS
  {
    email: 'creator01@aicinema.com',
    fullName: 'Nguyễn Minh Anh',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator02@aicinema.com',
    fullName: 'Trần Quốc Bảo',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator03@aicinema.com',
    fullName: 'Lê Hoàng Nam',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator04@aicinema.com',
    fullName: 'Phạm Gia Huy',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator05@aicinema.com',
    fullName: 'Võ Thành Đạt',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator06@aicinema.com',
    fullName: 'Đặng Nhật Minh',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator07@aicinema.com',
    fullName: 'Bùi Đức Anh',
    role: UserRole.CONTENT_CREATOR,
  },
  {
    email: 'creator08@aicinema.com',
    fullName: 'Ngô Tuấn Kiệt',
    role: UserRole.CONTENT_CREATOR,
  },

  // CONTENT REVIEWERS
  {
    email: 'reviewer01@aicinema.com',
    fullName: 'Nguyễn Thu Hà',
    role: UserRole.CONTENT_REVIEWER,
  },
  {
    email: 'reviewer02@aicinema.com',
    fullName: 'Trần Ngọc Linh',
    role: UserRole.CONTENT_REVIEWER,
  },
  {
    email: 'reviewer03@aicinema.com',
    fullName: 'Lê Thanh Hương',
    role: UserRole.CONTENT_REVIEWER,
  },
  {
    email: 'reviewer04@aicinema.com',
    fullName: 'Phạm Khánh Vy',
    role: UserRole.CONTENT_REVIEWER,
  },
  {
    email: 'reviewer05@aicinema.com',
    fullName: 'Vũ Minh Trang',
    role: UserRole.CONTENT_REVIEWER,
  },
  {
    email: 'reviewer06@aicinema.com',
    fullName: 'Đỗ Hoàng Long',
    role: UserRole.CONTENT_REVIEWER,
  },

  // STAFF / ADMIN / MEMBER
  {
    email: 'staff01@aicinema.com',
    fullName: 'Nguyễn Văn Thành',
    role: UserRole.STAFF,
  },
  {
    email: 'admin@aicinema.com',
    fullName: 'AI Cinema Admin',
    role: UserRole.ADMIN,
  },
  {
    email: 'member01@aicinema.com',
    fullName: 'Nguyễn Hoàng Anh',
    role: UserRole.MEMBER,
  },
  // Tester accounts with password 123456
  {
    email: 'adminn@gmail.com',
    fullName: 'Admin Tester',
    role: UserRole.ADMIN,
    password: '123456',
  },
  {
    email: 'creatorr@gmail.com',
    fullName: 'Creator Tester',
    role: UserRole.CONTENT_CREATOR,
    password: '123456',
  },
  {
    email: 'reviewerr@gmail.com',
    fullName: 'Reviewer Tester',
    role: UserRole.CONTENT_REVIEWER,
    password: '123456',
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
  for (const { name, description } of GENRE_CATALOG) {
    await prisma.genre.upsert({
      where: { name },
      update: { description },
      create: { name, description },
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

  const defaultPasswordHash = await bcrypt.hash(SEED_USER_PASSWORD, 10);
  for (const user of users) {
    const { password, ...userData } = user as any;
    const userHash = password ? await bcrypt.hash(password, 10) : defaultPasswordHash;
    const existing = await prisma.user.findUnique({ where: { email: userData.email } });
    if (!existing) {
      await prisma.user.create({ data: { ...userData, passwordHash: userHash, isActive: true } });
      continue;
    }
    // A password someone already set is kept; only placeholder hashes or explicitly provided passwords are replaced.
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        fullName: userData.fullName,
        role: userData.role,
        isActive: true,
        ...(password || existing.passwordHash.startsWith(PLACEHOLDER_HASH_PREFIX) ? { passwordHash: userHash } : {}),
      },
    });
  }

  for (const entry of Object.values(AI_MODEL_CATALOG)) {
    const provider = await prisma.aiProvider.upsert({
      where: { name: entry.provider },
      update: {},
      create: { name: entry.provider },
    });
    await prisma.aiModel.upsert({
      where: { aiProviderId_name_version: { aiProviderId: provider.id, name: entry.name, version: entry.version } },
      update: { modality: entry.modality },
      create: { aiProviderId: provider.id, name: entry.name, version: entry.version, modality: entry.modality },
    });
  }

  const loraBase = AI_MODEL_CATALOG.image;
  const fluxModel = await prisma.aiModel.findFirstOrThrow({
    where: { name: loraBase.name, version: loraBase.version, provider: { name: loraBase.provider } },
  });
  const styleOwner = await prisma.user.findUniqueOrThrow({ where: { email: 'reviewer01@aicinema.com' } });
  // One DRAFT style (and dataset folder) per genre; only the ones whose
  // folder reaches minSampleThreshold ever get trained.
  for (const entry of GENRE_CATALOG) {
    const genre = await prisma.genre.findUniqueOrThrow({ where: { name: entry.name } });
    const triggerKeyword = genreStyleTriggerKeyword(entry.styleKey);
    const name = `${entry.name} Style`;
    await prisma.genreStyleModel.upsert({
      where: {
        baseAiModelId_triggerKeyword_version: { baseAiModelId: fluxModel.id, triggerKeyword, version: 1 },
      },
      update: { name },
      create: {
        genreId: genre.id,
        baseAiModelId: fluxModel.id,
        name,
        triggerKeyword,
        trainingProvider: 'fal.ai',
        createdById: styleOwner.id,
      },
    });
  }

  console.log('Seeded genres, users, AI labeling policy, AI model catalog and genre style LoRAs.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
