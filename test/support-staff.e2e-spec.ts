// The canned AI answers of AI_MODE=mock: no model call in CI.
process.env.AI_MODE = 'mock';
import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { bootApp, signIn, type Actor, type Row } from './support/api';
import { registerMember } from './support/members';

type Conversation = Row & { status: string; aiSummary: string | null; escalationReason: string | null };

/** Member asks for a human (button), Staff works the case with the AI draft, Member confirms (AI_MODE=mock). */
describe('AI Customer Support — Staff hand-off (e2e)', () => {
  let app: INestApplication<App>;
  let member: Actor;
  let staff: Actor;
  let caseId: string;

  beforeAll(async () => {
    app = await bootApp();
    member = await registerMember(app);
    staff = await signIn(app, 'admin@aicinema.com');
  }, 120000);

  afterAll(() => app.close());

  it('member chats with the AI, then asks for a human with the button', async () => {
    const started = await member.post<Conversation>('/support/conversations');
    caseId = started.id;
    await member.post(
      `/support/conversations/${caseId}/messages`,
      { content: 'Số dư Coin của tôi là bao nhiêu?' },
      200,
    );

    const escalated = await member.post<{ conversation: Conversation }>(
      `/support/conversations/${caseId}/request-staff`,
      { note: 'Tôi muốn nói chuyện với nhân viên' },
      200,
    );
    expect(escalated.conversation.escalationReason).toBe('MEMBER_REQUEST');
    const detail = await member.get<{ conversation: Conversation }>(`/support/conversations/${caseId}`);
    expect(detail.conversation.aiSummary).toBeTruthy();
    const list = await member.get<{ data: Row[] }>('/support/conversations');
    expect(list.data.some((c) => c.id === caseId)).toBe(true);
  });

  it('staff reads the queue, stats, case and member context, and gets an AI draft', async () => {
    const queue = await staff.get<{ data: Row[] }>('/admin/support/conversations');
    expect(queue.data.some((c) => c.id === caseId)).toBe(true);
    await staff.get('/admin/support/stats');
    await staff.get(`/admin/support/conversations/${caseId}`);
    await staff.get(`/admin/support/conversations/${caseId}/member-context`);
    const draft = await staff.post<{ draft: string; sources: unknown[] }>(
      `/admin/support/conversations/${caseId}/ai-suggestion`,
      {},
      200,
    );
    expect(typeof draft.draft).toBe('string');
    await staff.post(
      `/admin/support/conversations/${caseId}/ai-suggestion`,
      { question: 'Chính sách hoàn Coin khi tập bị gỡ?' },
      200,
    );
  });

  it('staff claims, releases, claims again, replies and resolves; member confirms and cannot reopen', async () => {
    await staff.post(`/admin/support/conversations/${caseId}/claim`, {}, 200);
    await staff.post(`/admin/support/conversations/${caseId}/release`, {}, 200);
    await staff.post(`/admin/support/conversations/${caseId}/claim`, {}, 200);
    await staff.post(
      `/admin/support/conversations/${caseId}/messages`,
      { content: 'Ghi chú nội bộ', isInternal: true },
      200,
    );
    await staff.post(`/admin/support/conversations/${caseId}/messages`, { content: 'Số dư của bạn đã đúng.' }, 200);
    await staff.post(`/admin/support/conversations/${caseId}/resolve`, { note: 'Đã giải thích số dư' }, 200);

    await member.post(`/support/conversations/${caseId}/read`, {}, 204);
    // confirm-resolved is for an AI answer; Staff closes the case it resolved (or the auto-close sweep does).
    await member.post(`/support/conversations/${caseId}/confirm-resolved`, { rating: 5 }, 409);
    await staff.post(`/admin/support/conversations/${caseId}/close`, {}, 200);
    await member.post(`/support/conversations/${caseId}/request-staff`, {}, 409);
  });

  it('member opens a new case after the old one closed, pages messages and closes it', async () => {
    const next = await member.post<Conversation>('/support/conversations');
    expect(next.id).not.toBe(caseId);
    await member.post(`/support/conversations/${next.id}/messages`, { content: 'Gói Tháng giá bao nhiêu?' }, 200);
    await member.post(`/support/conversations/${next.id}/messages`, {}, 400);
    await member.get(`/support/conversations/${next.id}/messages?limit=1`);
    await member.post(`/support/conversations/${next.id}/close`, { note: 'Đã hiểu' }, 200);
    await member.post(`/support/conversations/${next.id}/messages`, { content: 'Còn nữa' }, 409);
    await staff.post(`/admin/support/conversations/${next.id}/ai-suggestion`, {}, 200);
    await staff.post(`/admin/support/conversations/${next.id}/claim`, {}, 409);
    await staff.post('/admin/support/conversations/00000000-0000-4000-8000-000000000000/ai-suggestion', {}, 404);
    await staff.post(
      `/admin/support/conversations/${next.id}/assign`,
      { staffId: '00000000-0000-4000-8000-000000000000' },
      400,
    );
  });
});
