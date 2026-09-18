import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, PolicyType } from '@prisma/client';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const adapter = new PrismaPg(new Pool({ connectionString }));
const prisma = new PrismaClient({ adapter });

const genres = [
  { name: 'Action', description: 'Movies characterized by physical stunts, fights, and intense action sequences.' },
  {
    name: 'Adventure',
    description: 'Movies featuring journeys, exploration, and often perilous quests in exotic settings.',
  },
  {
    name: 'Animation',
    description: 'Movies created through computer animation, traditional hand-drawn frames, or stop-motion.',
  },
  { name: 'Biography', description: 'Movies depicting the real life of a notable person or historical figure.' },
  {
    name: 'Comedy',
    description: 'Movies intended to amuse and provoke laughter through humor and exaggerated situations.',
  },
  { name: 'Crime', description: 'Movies centered on criminals, law enforcement, and the moral ambiguity of the law.' },
  { name: 'Documentary', description: 'Non-fiction movies presenting real events, people, or factual accounts.' },
  { name: 'Drama', description: 'Movies focused on emotional character development and realistic conflicts.' },
  {
    name: 'Family',
    description: 'Movies suitable for viewers of all ages, often centering on family bonds and values.',
  },
  { name: 'Fantasy', description: 'Movies set in magical or supernatural worlds beyond the limits of reality.' },
  { name: 'History', description: 'Movies recreating or dramatizing real historical events and periods.' },
  { name: 'Horror', description: 'Movies designed to scare, shock, or unsettle through suspense and dread.' },
  { name: 'Musical', description: 'Movies where songs and choreography are fully integrated into the storytelling.' },
  { name: 'Mystery', description: 'Movies driven by suspense and the gradual revelation of a puzzling secret.' },
  { name: 'Romance', description: 'Movies centered on love and the emotional journey of the central relationship.' },
  {
    name: 'Sci-Fi',
    description: 'Movies exploring futuristic science, technology, outer space, or alternate realities.',
  },
  { name: 'Sport', description: 'Movies revolving around athletes, competitions, and the pursuit of victory.' },
  {
    name: 'Thriller',
    description: 'Movies creating tension, excitement, and anxiety through plot twists and suspense.',
  },
  { name: 'War', description: 'Movies depicting armed conflicts and their impact on soldiers and civilians.' },
  {
    name: 'Western',
    description: 'Movies set in the American frontier, featuring cowboys, outlaws, and the Old West.',
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

  console.log('Seeded genres and AI labeling policy.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
