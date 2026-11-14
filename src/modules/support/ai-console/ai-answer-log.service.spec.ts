import { ConflictException, NotFoundException } from '@nestjs/common';
import { SupportAiFeedback, SupportSenderType } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from 'src/modules/platform/audit-log/audit-log.service';
import { CONTENT_EVENT } from 'src/modules/platform/audit-log/content-events';
import { AiAnswerLogService } from './ai-answer-log.service';

function build() {
  const prisma = {
    supportMessage: { findUnique: jest.fn(), update: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AiAnswerLogService(prisma as unknown as PrismaService, audit as unknown as AuditLogService);
  return { service, prisma, audit };
}

describe('AiAnswerLogService.rate', () => {
  it('stores the verdict on an AI answer and audits it', async () => {
    const { service, prisma, audit } = build();
    prisma.supportMessage.findUnique.mockResolvedValue({
      id: 'm1',
      senderType: SupportSenderType.AI_CHATBOT,
      isInternal: false,
    });
    prisma.supportMessage.update.mockResolvedValue({ id: 'm1', aiFeedback: SupportAiFeedback.NOT_HELPFUL });

    await service.rate('m1', SupportAiFeedback.NOT_HELPFUL, '  Thiếu bài về hoàn Coin ', 'admin-1');

    expect(prisma.supportMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm1' },
        data: expect.objectContaining({
          aiFeedback: SupportAiFeedback.NOT_HELPFUL,
          aiFeedbackNote: 'Thiếu bài về hoàn Coin',
          aiFeedbackById: 'admin-1',
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: CONTENT_EVENT.SUPPORT_AI_ANSWER_RATED, entityType: 'SupportMessage' }),
    );
  });

  it('refuses a member or Staff message, and 404s an unknown one', async () => {
    const { service, prisma } = build();
    prisma.supportMessage.findUnique.mockResolvedValueOnce({
      id: 'm2',
      senderType: SupportSenderType.MEMBER,
      isInternal: false,
    });
    await expect(service.rate('m2', SupportAiFeedback.HELPFUL, undefined, 'admin-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    prisma.supportMessage.findUnique.mockResolvedValueOnce(null);
    await expect(service.rate('m3', SupportAiFeedback.HELPFUL, undefined, 'admin-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.supportMessage.update).not.toHaveBeenCalled();
  });
});

describe('AiAnswerLogService.summary', () => {
  it('turns the SQL counters into numbers and derives the unrated count', async () => {
    const { service, prisma } = build();
    prisma.$queryRaw.mockResolvedValue([{ total: 10n, helpful: 4n, not_helpful: 2n, handed_off: 3n, avg_rating: 4.5 }]);
    await expect(service.summary()).resolves.toEqual({
      totalAnswers: 10,
      helpful: 4,
      notHelpful: 2,
      unrated: 4,
      handedOffToStaff: 3,
      averageSatisfaction: 4.5,
    });
  });
});
