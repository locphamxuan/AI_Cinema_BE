import { ConflictException } from '@nestjs/common';
import { SupportStatus } from '@prisma/client';
import { buildChatService, CONVERSATION_ID, conversationRow, MEMBER_ID } from './support-chat.fixtures';

describe('SupportChatService — closing and reopening a case', () => {
  it('refuses requestStaff on a closed case', async () => {
    const { service, conversations } = buildChatService();
    conversations.findOwned.mockResolvedValue(conversationRow({ status: SupportStatus.CLOSED }));
    await expect(service.requestStaff(MEMBER_ID, CONVERSATION_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('reopens a case Staff resolved when the member still needs help, telling Staff once', async () => {
    const { service, conversations, resolution, recipients } = buildChatService();
    conversations.findOwned.mockResolvedValue(conversationRow({ status: SupportStatus.RESOLVED }));
    const waiting = conversationRow({ status: SupportStatus.WAITING_FOR_STAFF });
    resolution.reopen.mockResolvedValueOnce({ conversation: waiting, changed: true });

    const result = await service.requestStaff(MEMBER_ID, CONVERSATION_ID);

    expect(result.conversation.status).toBe(SupportStatus.WAITING_FOR_STAFF);
    expect(resolution.reopen).toHaveBeenCalledWith(CONVERSATION_ID, MEMBER_ID);
    expect(recipients.notifyMemberReply).toHaveBeenCalledWith(waiting, expect.stringContaining('vẫn cần hỗ trợ'));

    resolution.reopen.mockResolvedValueOnce({ conversation: waiting, changed: false });
    await service.requestStaff(MEMBER_ID, CONVERSATION_ID);
    expect(recipients.notifyMemberReply).toHaveBeenCalledTimes(1);
  });

  it('closes on the member confirmation: the AI answer, or the work Staff marked resolved', async () => {
    const { service, conversations, resolution } = buildChatService();
    conversations.findById.mockResolvedValue(conversationRow({ status: SupportStatus.CLOSED }));
    conversations.findOwned.mockResolvedValue(conversationRow({ status: SupportStatus.AI_HANDLING }));
    await service.confirmResolved(MEMBER_ID, CONVERSATION_ID);
    expect(resolution.aiResolved).toHaveBeenCalledWith(CONVERSATION_ID, MEMBER_ID);
    conversations.findOwned.mockResolvedValue(conversationRow({ status: SupportStatus.RESOLVED }));
    await service.confirmResolved(MEMBER_ID, CONVERSATION_ID);
    expect(resolution.staffResolutionConfirmed).toHaveBeenCalledWith(CONVERSATION_ID, MEMBER_ID);
  });
});
