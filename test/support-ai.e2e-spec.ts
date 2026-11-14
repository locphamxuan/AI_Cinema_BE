// Support E2E in AI_MODE=mock (TODO §5.2).
//
// Why a separate file from support-ai-disabled.e2e-spec.ts: the app config is read while the
// Nest module is compiled, so each AI mode gets its own suite process.
pressMockEnv();
function pressMockEnv() {
  process.env.AI_MODE = 'mock';
}

import { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, SupportStatus, UserRole } from '@prisma/client';
import type { App } from 'supertest/types';
import { bootApp, signIn, type Actor, type Row } from './support/api';
import { createAccounts, SEED_USER_PASSWORD } from '../prisma/seed-accounts';

const RUN = `e2e-${Date.now()}`;
const MEMBER_EMAIL = 'member01@aicinema.com'; // e2e-accounts
const OTHER_MEMBER_EMAIL = `member02-${RUN}@aicinema.com`;
const STAFF_A_EMAIL = `staff-a-${RUN}@aicinema.com`;
const STAFF_B_EMAIL = `staff-b-${RUN}@aicinema.com`;
const ADMIN_EMAIL = 'admin@aicinema.com'; // e2e-accounts

let app: INestApplication<App>;
let prisma: PrismaClient;
let member: Actor;
let otherMember: Actor;
let staffA: Actor;
let staffB: Actor;
let admin: Actor;

type ConversationRow = Row & {
  id: string;
  status: string;
  aiSummary: string | null;
  escalationReason: string | null;
};

type SendResult = Row & {
  conversation: ConversationRow;
  memberMessage: Row & { id: string };
  aiMessage: (Row & { id: string }) | null;
  systemMessage: (Row & { id: string }) | null;
  quickReplies: string[];
};

beforeAll(async () => {
  prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  await createAccounts(
    prisma,
    [
      { email: OTHER_MEMBER_EMAIL, fullName: 'Member e2e 2', role: UserRole.MEMBER },
      { email: STAFF_A_EMAIL, fullName: 'Staff e2e A', role: UserRole.STAFF },
      { email: STAFF_B_EMAIL, fullName: 'Staff e2e B', role: UserRole.STAFF },
    ],
    SEED_USER_PASSWORD,
  );
  // Fresh slate for the member flows: stale cases from an earlier run would be reused.
  const e2eUsers = await prisma.user.findMany({ where: { email: { in: [MEMBER_EMAIL, OTHER_MEMBER_EMAIL] } } });
  const e2eMemberIds = e2eUsers.map((user) => user.id);
  await prisma.supportMessage.deleteMany({ where: { conversation: { memberId: { in: e2eMemberIds } } } });
  await prisma.supportConversation.deleteMany({ where: { memberId: { in: e2eMemberIds } } });
  // Known Coin balance the member wallet screen reports (item §5.2 #3 is adapted: in mock
  // mode the canned AI reply cannot run tools; "right balance" is asserted at the wallet API).
  await prisma.coinWallet.upsert({
    where: { userId: e2eUsers.find((user) => user.email === MEMBER_EMAIL)!.id },
    create: { userId: e2eUsers.find((user) => user.email === MEMBER_EMAIL)!.id, mainBalance: 123, bonusBalance: 7 },
    update: { mainBalance: 123, bonusBalance: 7 },
  });

  app = await bootApp();
  member = await signIn(app, MEMBER_EMAIL);
  otherMember = await signIn(app, OTHER_MEMBER_EMAIL);
  staffA = await signIn(app, STAFF_A_EMAIL);
  staffB = await signIn(app, STAFF_B_EMAIL);
  admin = await signIn(app, ADMIN_EMAIL);
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

let caseId: string;

describe('AI Customer Support E2E (AI_MODE=mock)', () => {
  it('member opens a case and a second start reuses the same open case (#1)', async () => {
    const first = await member.post<ConversationRow>('/support/conversations');
    expect(first.status).toBe(SupportStatus.AI_HANDLING);

    const second = await member.post<ConversationRow>('/support/conversations');
    expect(second.id).toBe(first.id);
    caseId = first.id;
  });

  it('a coin question gets a mock AI reply and the wallet reports the known balance (#1, #3)', async () => {
    const turn = await member.post<SendResult>(
      `/support/conversations/${caseId}/messages`,
      {
        content: 'Số dư Coin của tôi là bao nhiêu?',
        clientMessageId: 'balance-1',
      },
      200,
    );

    expect(turn.aiMessage).not.toBeNull();
    expect(turn.conversation.status).toBe(SupportStatus.AI_HANDLING);

    const wallet = await member.get<Row>('/wallet');
    expect(wallet.mainBalance).toBe(123);
    expect(wallet.bonusBalance).toBe(7);
  });

  it('sending the same clientMessageId twice returns the first AI answer only (#2)', async () => {
    const turn = await member.post<SendResult>(
      `/support/conversations/${caseId}/messages`,
      {
        content: 'Số dư Coin của tôi là bao nhiêu?',
        clientMessageId: 'balance-1',
      },
      200,
    );

    expect(turn.memberMessage.id).toBeDefined();
    expect(turn.aiMessage?.id).toBeDefined();

    const rows = await prisma.supportMessage.findMany({
      where: { conversationId: caseId, clientMessageId: 'balance-1' },
    });
    expect(rows).toHaveLength(1);
    expect(turn.aiMessage?.id).toBe(
      (await prisma.supportMessage.findFirst({ where: { conversationId: caseId, senderType: 'AI_CHATBOT' } }))?.id,
    );
  });

  it('an out-of-KB question still gets a mock answer (not-in-KB escalation needs a live model, §6) (#4)', async () => {
    const turn = await member.post<SendResult>(
      `/support/conversations/${caseId}/messages`,
      {
        content: 'Chế độ bảo hành máy giặt inox có áp dụng cho quần áo trẻ em không?',
        clientMessageId: 'gibberish-1',
      },
      200,
    );

    expect(turn.aiMessage).not.toBeNull();
    expect(turn.conversation.status).toBe(SupportStatus.AI_HANDLING);
  });

  it('member asking for a human escalates with a summary and notifies staff (#4 escalate path, #5)', async () => {
    const turn = await member.post<SendResult>(
      `/support/conversations/${caseId}/messages`,
      {
        content: 'Tôi muốn gặp nhân viên hỗ trợ',
        clientMessageId: 'staff-request-1',
      },
      200,
    );

    expect(turn.conversation.status).toBe(SupportStatus.WAITING_FOR_STAFF);
    expect(turn.conversation.escalationReason).toBe('MEMBER_REQUEST');
    expect(turn.aiMessage).not.toBeNull();

    const detail = await member.get<{ conversation: ConversationRow; messages: Row[] }>(
      `/support/conversations/${caseId}`,
    );
    expect(detail.conversation.aiSummary).toBeTruthy();

    const notes = await prisma.notification.findMany({
      where: { userId: staffA.id, type: 'SUPPORT_CASE_ESCALATED', link: `/admin/support/conversations/${caseId}` },
    });
    expect(notes).toHaveLength(1);
  });

  it('staff A claims the case and staff B loses the claim with 409 (#6)', async () => {
    const claimed = await staffA.post<Row>(`/admin/support/conversations/${caseId}/claim`, {}, 200);
    expect(claimed.status).toBe(SupportStatus.STAFF_HANDLING);
    expect(claimed.assignedAgentId).toBe(staffA.id);

    const res = await staffB.call('post', `/admin/support/conversations/${caseId}/claim`, {}, 409);
    expect(res).toBeDefined();
  });

  it('staff reply reaches the member (with notification) while internal notes stay hidden (#7)', async () => {
    await staffA.post<Row>(
      `/admin/support/conversations/${caseId}/messages`,
      {
        content: 'Chào bạn, mình kiểm tra sổ cái rồi.',
        isInternal: false,
      },
      200,
    );

    const memberDetail = await member.get<{ messages: Array<Row & { content: string; isInternal: boolean }> }>(
      `/support/conversations/${caseId}`,
    );
    expect(memberDetail.messages.some((message) => message.content === 'Chào bạn, mình kiểm tra sổ cái rồi.')).toBe(
      true,
    );

    const notifs = await member.get<{ data: Array<Row & { type: string }> }>('/notifications');
    expect(notifs.data.some((item) => item.type === 'SUPPORT_AGENT_REPLIED')).toBe(true);

    await staffA.post<Row>(
      `/admin/support/conversations/${caseId}/messages`,
      {
        content: 'Note nội bộ: member có lịch sử hoàn tiền.',
        isInternal: true,
      },
      200,
    );

    const memberDetailAfterNote = await member.get<{ messages: Array<Row & { content: string; isInternal: boolean }> }>(
      `/support/conversations/${caseId}`,
    );
    expect(memberDetailAfterNote.messages.every((message) => !message.content.includes('Note nội bộ'))).toBe(true);

    const staffDetail = await staffA.get<{ messages: Array<Row & { content: string; isInternal: boolean }> }>(
      `/admin/support/conversations/${caseId}`,
    );
    expect(staffDetail.messages.some((message) => message.content.includes('Note nội bộ') && message.isInternal)).toBe(
      true,
    );
  });

  it('staff resolve then close ends the case but keeps the transcript (#8)', async () => {
    const resolved = await staffA.post<Row>(
      `/admin/support/conversations/${caseId}/resolve`,
      {
        note: 'Đã xử lý xong vấn đề của bạn.',
      },
      200,
    );
    expect(resolved.status).toBe(SupportStatus.RESOLVED);

    const closed = await staffA.post<Row>(
      `/admin/support/conversations/${caseId}/close`,
      {
        note: 'Đóng sau khi xác nhận với thành viên.',
      },
      200,
    );
    expect(closed.status).toBe(SupportStatus.CLOSED);

    const detail = await member.get<{ conversation: ConversationRow; messages: Row[] }>(
      `/support/conversations/${caseId}`,
    );
    expect(detail.conversation.status).toBe(SupportStatus.CLOSED);
    expect(detail.messages.length).toBeGreaterThan(0);
  });

  it('a member cannot read or write another member’s conversation (#9)', async () => {
    await otherMember.get(`/support/conversations/${caseId}`, 404);
    await otherMember.post(`/support/conversations/${caseId}/messages`, { content: 'Này' }, 404);
    await otherMember.post(`/support/conversations/${caseId}/close`, {}, 404);

    const mine = await otherMember.get<{ data: ConversationRow[] }>('/support/conversations');
    expect(mine.data.every((row) => row.id !== caseId)).toBe(true);
  });
});

describe('Admin knowledge base (§5.2 #11)', () => {
  const slug = `e2e-kb-${Date.now()}`;

  it('creates, previews, updates, reindexes and archives articles', async () => {
    const created = await admin.post<Row & { indexStatus: string; status: string }>('/admin/support/knowledge', {
      title: 'E2E: Số dư Coin',
      slug,
      category: 'Coin',
      contentMarkdown: '# Số dư Coin\nSố dư Coin của bạn hiển thị ở ví chính.',
      status: 'PUBLISHED',
    });
    expect(created.id).toBeDefined();
    expect(created.status).toBe('PUBLISHED');

    const detail = await admin.get<{ chunks: Row[] }>(`/admin/support/knowledge/${created.id}`);
    expect(detail.chunks.length).toBeGreaterThan(0);

    const preview = await admin.post<{ articles: Array<Row & { articleId: string }>; totalFound: number }>(
      '/admin/support/knowledge/preview',
      { query: 'Số dư Coin' },
      200,
    );
    expect(preview.totalFound).toBeGreaterThan(0);
    expect(preview.articles.some((article) => article.articleId === created.id)).toBe(true);

    const updated = await admin.patch<Row>(`/admin/support/knowledge/${created.id}`, {
      title: 'E2E: Số dư Coin (mới)',
    });
    expect(updated.title).toBe('E2E: Số dư Coin (mới)');

    const reindexed = await admin.post<Row>(`/admin/support/knowledge/${created.id}/reindex`, {}, 200);
    expect(reindexed.indexStatus).toBe('PENDING');

    const archived = await admin.post<Row & { status: string }>(
      `/admin/support/knowledge/${created.id}/archive`,
      {},
      200,
    );
    expect(archived.status).toBe('ARCHIVED');

    const afterArchive = await admin.get<{ chunks: Row[] }>(`/admin/support/knowledge/${created.id}`);
    expect(afterArchive.chunks).toHaveLength(0);

    const previewAfter = await admin.post<{ articles: Array<Row & { articleId: string }> }>(
      '/admin/support/knowledge/preview',
      { query: 'Số dư Coin' },
      200,
    );
    expect(previewAfter.articles.some((article) => article.articleId === created.id)).toBe(false);

    const list = await admin.get<{ data: Row[] }>('/admin/support/knowledge?search=e2e');
    expect(list.data).toBeDefined();
  });
});

describe('permissions (§5.2 #12)', () => {
  it('member cannot open staff or knowledge admin screens', async () => {
    await member.get('/admin/support/conversations', 403);
    await member.get('/admin/support/knowledge', 403);
    await member.post(
      '/admin/support/knowledge',
      {
        title: 'X',
        slug: `e2e-fail-${Date.now()}`,
        category: 'Coin',
        contentMarkdown: 'x',
      },
      403,
    );
  });

  it('staff reads the queue but cannot manage the KB or reassign cases', async () => {
    await staffA.get('/admin/support/conversations', 200);
    await staffA.get('/admin/support/ai/health', 200);
    await staffA.get('/admin/support/knowledge', 403);
    await staffA.post(
      '/admin/support/knowledge',
      {
        title: 'X',
        slug: `e2e-fail-2-${Date.now()}`,
        category: 'Coin',
        contentMarkdown: 'x',
      },
      403,
    );
    await staffA.post(`/admin/support/conversations/${caseId}/assign`, { staffId: staffB.id }, 403);
  });

  it('admin sees the staff queue and AI health', async () => {
    const queue = await admin.get<{ data: Row[] }>('/admin/support/conversations');
    expect(Array.isArray(queue.data)).toBe(true);

    const health = await admin.get<Row & { mode: string }>('/admin/support/ai/health');
    expect(health.mode).toBe('mock');
  });
});
