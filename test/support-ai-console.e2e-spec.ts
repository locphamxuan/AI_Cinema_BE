// Admin AI console E2E (AI_MODE=mock, 2026-11-14): delete a KB article for good, test the chatbot in the
// playground, and rate the answers it gave members.
pressMockEnv();
function pressMockEnv() {
  process.env.AI_MODE = 'mock';
}

import { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '@prisma/client';
import type { App } from 'supertest/types';
import { bootApp, signIn, type Actor, type Row } from './support/api';
import { createAccounts, SEED_USER_PASSWORD } from '../prisma/seed-accounts';

const RUN = `e2e-console-${Date.now()}`;
const MEMBER_EMAIL = `member-${RUN}@aicinema.com`;
const STAFF_EMAIL = `staff-${RUN}@aicinema.com`;
const ADMIN_EMAIL = 'admin@aicinema.com'; // e2e-accounts

let app: INestApplication<App>;
let prisma: PrismaClient;
let member: Actor;
let staff: Actor;
let admin: Actor;

type AnswerRow = Row & {
  id: string;
  question: string | null;
  answer: string;
  feedback: string | null;
  feedbackNote: string | null;
  conversation: Row & { member: Row & { email: string } };
};

beforeAll(async () => {
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  await createAccounts(
    prisma,
    [
      { email: MEMBER_EMAIL, fullName: 'Member AI console', role: UserRole.MEMBER },
      { email: STAFF_EMAIL, fullName: 'Staff AI console', role: UserRole.STAFF },
    ],
    SEED_USER_PASSWORD,
  );
  app = await bootApp();
  member = await signIn(app, MEMBER_EMAIL);
  staff = await signIn(app, STAFF_EMAIL);
  admin = await signIn(app, ADMIN_EMAIL);
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Knowledge Base: delete', () => {
  it('deletes an article with its chunks, so retrieval no longer finds it', async () => {
    const created = await admin.post<Row & { id: string }>('/admin/support/knowledge', {
      title: 'E2E console: Đổi mật khẩu',
      slug: `${RUN}-password`,
      category: 'Tài khoản',
      contentMarkdown: '# Đổi mật khẩu\nVào Hồ sơ, chọn Đổi mật khẩu zyxconsole.',
      status: 'PUBLISHED',
    });

    await expect(admin.call('delete', `/admin/support/knowledge/${created.id}`)).resolves.toEqual({
      id: created.id,
      deleted: true,
    });
    await admin.get(`/admin/support/knowledge/${created.id}`, 404);
    expect(await prisma.supportKnowledgeChunk.count({ where: { articleId: created.id } })).toBe(0);
    await admin.call('delete', `/admin/support/knowledge/${created.id}`, undefined, 404);

    const preview = await admin.post<{ articles: Array<Row & { articleId: string }> }>(
      '/admin/support/knowledge/preview',
      { query: 'zyxconsole' },
      200,
    );
    expect(preview.articles.some((article) => article.articleId === created.id)).toBe(false);
  });
});

describe('AI playground', () => {
  it('answers a test question with the articles it retrieved and stores nothing', async () => {
    const created = await admin.post<Row & { id: string }>('/admin/support/knowledge', {
      title: 'E2E console: Hủy gói Tháng',
      slug: `${RUN}-cancel`,
      category: 'Gói cước',
      contentMarkdown: '# Hủy gói Tháng\nHủy trong 24 giờ đầu được hoàn tiền qwvplayground.',
      status: 'PUBLISHED',
    });
    const before = await prisma.supportMessage.count();

    const reply = await admin.post<Row & { answer: string; retrieved: Array<Row & { articleId: string }> }>(
      '/admin/support/ai/preview-chat',
      { question: 'Hủy gói qwvplayground có được hoàn tiền không?', history: [{ role: 'MEMBER', content: 'Chào' }] },
      200,
    );
    expect(typeof reply.answer).toBe('string');
    expect(reply.answer.length).toBeGreaterThan(0);
    expect(reply.retrieved.some((chunk) => chunk.articleId === created.id)).toBe(true);
    expect(await prisma.supportMessage.count()).toBe(before);

    await admin.post('/admin/support/ai/preview-chat', { question: 'x' }, 400);
    await admin.post(
      '/admin/support/ai/preview-chat',
      { question: 'Chào', history: [{ role: 'BOT', content: 'a' }] },
      400,
    );
    await admin.call('delete', `/admin/support/knowledge/${created.id}`);
  });
});

describe('AI answer log and feedback', () => {
  it('lists the answers the AI gave members and stores the Admin rating', async () => {
    const conversation = await member.post<Row & { id: string }>('/support/conversations');
    const turn = await member.post<Row & { aiMessage: Row & { id: string } }>(
      `/support/conversations/${conversation.id}/messages`,
      { content: 'Làm sao để nạp Coin?', clientMessageId: `${RUN}-1` },
      200,
    );
    const answerId = turn.aiMessage.id;

    const log = await admin.get<{ data: AnswerRow[] }>(
      `/admin/support/ai/answers?filter.conversationId=$eq:${conversation.id}`,
    );
    const row = log.data.find((answer) => answer.id === answerId)!;
    expect(row.question).toBe('Làm sao để nạp Coin?');
    expect(row.feedback).toBeNull();
    expect(row.conversation.member.email).toBe(MEMBER_EMAIL);

    const rated = await admin.post<Row & { aiFeedback: string; aiFeedbackNote: string }>(
      `/admin/support/ai/answers/${answerId}/feedback`,
      { rating: 'NOT_HELPFUL', note: 'Thiếu bài hướng dẫn nạp Coin qua VNPay' },
      200,
    );
    expect(rated.aiFeedback).toBe('NOT_HELPFUL');

    const notHelpful = await admin.get<{ data: AnswerRow[] }>(
      '/admin/support/ai/answers?filter.aiFeedback=$eq:NOT_HELPFUL&limit=100',
    );
    expect(notHelpful.data.some((answer) => answer.id === answerId)).toBe(true);

    const summary = await admin.get<Row & { totalAnswers: number; notHelpful: number; unrated: number }>(
      '/admin/support/ai/answers/summary',
    );
    expect(summary.notHelpful).toBeGreaterThanOrEqual(1);
    expect(summary.totalAnswers).toBeGreaterThanOrEqual(summary.notHelpful + summary.unrated);

    const memberMessageId = (turn as Row & { memberMessage: Row & { id: string } }).memberMessage.id;
    await admin.post(`/admin/support/ai/answers/${memberMessageId}/feedback`, { rating: 'HELPFUL' }, 409);
    await admin.post(`/admin/support/ai/answers/${answerId}/feedback`, { rating: 'MEH' }, 400);
  });

  it('is the Admin only: Staff and members get 403', async () => {
    for (const actor of [staff, member]) {
      await actor.get('/admin/support/ai/answers', 403);
      await actor.post('/admin/support/ai/preview-chat', { question: 'Xin chào' }, 403);
    }
  });
});
