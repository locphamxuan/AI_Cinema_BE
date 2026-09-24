import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, PolicyType, UserRole } from '@prisma/client';
import { Pool } from 'pg';
import { AI_MODEL_CATALOG } from '../src/modules/ai-model/ai-model-catalog';
import { GENRE_CATALOG, genreStyleTriggerKeyword } from './genre-catalog';

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
