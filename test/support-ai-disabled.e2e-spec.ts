// Support E2E in AI_MODE=disabled (§5.2 #10): the human inbox fallback.
process.env.AI_MODE = 'disabled';

import { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { App } from 'supertest/types';
import { bootApp, signIn, type Actor, type Row } from './support/api';

const MEMBER_EMAIL = 'member01@aicinema.com';
const ADMIN_EMAIL = 'admin@aicinema.com';

let app: INestApplication<App>;
let prisma: PrismaClient;
let member: Actor;

type ConversationRow = Row & {
  id: string;
  status: string;
  aiSummary: string | null;
  escalationReason: string | null;
};

type SendResult = Row & {
  conversation: ConversationRow;
  memberMessage: Row;
  aiMessage: Row | null;
  systemMessage: Row | null;
};

beforeAll(async () => {
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  const me = await prisma.user.findUnique({ where: { email: MEMBER_EMAIL }, select: { id: true } });
  if (!me) throw new Error(`seeded member ${MEMBER_EMAIL} not found`);
  await prisma.supportMessage.deleteMany({ where: { conversation: { memberId: me.id } } });
  await prisma.supportConversation.deleteMany({ where: { memberId: me.id } });

  app = await bootApp();
  member = await signIn(app, MEMBER_EMAIL);
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('AI Customer Support E2E (AI_MODE=disabled)', () => {
  it('falls back to a human inbox and escalates AI_UNAVAILABLE with a summary', async () => {
    const started = await member.post<ConversationRow>('/support/conversations');

    const turn = await member.post<SendResult>(
      `/support/conversations/${started.id}/messages`,
      {
        content: 'Tôi cần hỗ trợ gấp',
        clientMessageId: 'disabled-1',
      },
      200,
    );

    // No AI answer, but the member message is kept and the case goes to Staff.
    expect(turn.aiMessage).toBeNull();
    expect(turn.conversation.status).toBe('WAITING_FOR_STAFF');
    expect(turn.conversation.escalationReason).toBe('AI_UNAVAILABLE');
    expect(turn.systemMessage).not.toBeNull();

    const detail = await member.get<{ conversation: ConversationRow }>(`/support/conversations/${started.id}`);
    expect(detail.conversation.aiSummary).toContain('AI không thể trả lời (DISABLED)');

    const adminId = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL }, select: { id: true } });
    const notes = await prisma.notification.findMany({
      where: { userId: adminId!.id, type: 'SUPPORT_CASE_ESCALATED' },
    });
    expect(notes.length).toBeGreaterThan(0);
  });
});
