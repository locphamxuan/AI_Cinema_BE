import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { paginate, type PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { TOPUP_REASON } from './constants/topup-reason';
import { ORDER_VIEW, orderView, type OrderRow, type OrderWithPayments, PAYMENT_VIEW } from './utils/order-view';
import { isUuid, type GatewayCallback } from './utils/payment-callback.util';

/**
 * Read-only side of top-ups: order/payment lookups shared by the member screens,
 * the return trip and the webhook pipeline. Nothing here writes, so it stays free
 * of locks and side effects.
 */
@Injectable()
export class TopUpLookupService {
  constructor(private readonly prisma: PrismaService) {}

  listMine(userId: string, query: PaginateQuery) {
    return paginate(query, this.prisma.coinTopUp, {
      where: { userId },
      select: Object.keys(ORDER_VIEW) as (keyof OrderRow)[],
      relations: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
      sortableColumns: ['createdAt', 'amountVnd', 'status'],
      defaultSortBy: [['createdAt', 'DESC']],
      filterableColumns: { status: ['$eq', '$in'] },
    }).then((page) => ({
      ...page,
      data: (page.data as unknown as OrderWithPayments[]).map((row) => orderView(row, row.payments[0] ?? null)),
    }));
  }

  async findMine(userId: string, topUpId: string) {
    const topUp = await this.prisma.coinTopUp.findFirst({
      where: { id: topUpId, userId },
      include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!topUp)
      throw new NotFoundException({ message: 'Top-up not found', details: { reason: TOPUP_REASON.NOT_FOUND } });
    const row = topUp as unknown as OrderWithPayments;
    return orderView(row, row.payments[0] ?? null);
  }

  /** An order for the return trip or the support screen: any order of the provider, any owner. */
  async findForReturn(provider: PaymentProvider, ref: { topUpId?: string; providerTxnId?: string }) {
    if (ref.topUpId && !isUuid(ref.topUpId)) {
      throw new BadRequestException({
        message: 'The top-up reference is not a valid id',
        details: { reason: TOPUP_REASON.INVALID_CALLBACK },
      });
    }
    if (ref.topUpId) {
      const topUp = await this.prisma.coinTopUp.findUnique({ where: { id: ref.topUpId }, select: ORDER_VIEW });
      if (!topUp)
        throw new NotFoundException({ message: 'Top-up not found', details: { reason: TOPUP_REASON.NOT_FOUND } });
      const payment = await this.latestPaymentOf(topUp.id, provider);
      if (!payment)
        throw new NotFoundException({ message: 'Top-up not found', details: { reason: TOPUP_REASON.NOT_FOUND } });
      return orderView(topUp, payment);
    }
    if (ref.providerTxnId) {
      const payment = await this.prisma.payment.findUnique({
        where: { provider_providerTxnId: { provider, providerTxnId: ref.providerTxnId } },
        select: PAYMENT_VIEW,
      });
      if (!payment)
        throw new NotFoundException({ message: 'Top-up not found', details: { reason: TOPUP_REASON.NOT_FOUND } });
      const topUp = await this.prisma.coinTopUp.findUniqueOrThrow({
        where: { id: payment.coinTopUpId },
        select: ORDER_VIEW,
      });
      return orderView(topUp, payment);
    }
    throw new BadRequestException({
      message: 'The return trip needs a topUpId or a providerTxnId',
      details: { reason: TOPUP_REASON.INVALID_CALLBACK },
    });
  }

  /** The payment attempt a callback points at, with the order it belongs to. */
  async resolvePayment(provider: PaymentProvider, callback: GatewayCallback) {
    if (callback.providerTxnId) {
      const payment = await this.prisma.payment.findUnique({
        where: { provider_providerTxnId: { provider, providerTxnId: callback.providerTxnId } },
        select: PAYMENT_VIEW,
      });
      if (payment) {
        if (callback.topUpId && callback.topUpId !== payment.coinTopUpId) {
          throw new BadRequestException({
            message: 'The callback points at two different orders',
            details: { reason: TOPUP_REASON.INVALID_CALLBACK },
          });
        }
        const topUp = await this.prisma.coinTopUp.findUnique({
          where: { id: payment.coinTopUpId },
          select: ORDER_VIEW,
        });
        if (!topUp)
          throw new NotFoundException({ message: 'Top-up not found', details: { reason: TOPUP_REASON.NOT_FOUND } });
        return { payment, topUp };
      }
    }
    if (callback.topUpId && isUuid(callback.topUpId)) {
      const topUp = await this.prisma.coinTopUp.findUnique({ where: { id: callback.topUpId }, select: ORDER_VIEW });
      if (topUp) {
        const payment = await this.prisma.payment.findFirst({
          where: { coinTopUpId: topUp.id, provider },
          orderBy: { createdAt: 'desc' },
          select: PAYMENT_VIEW,
        });
        if (payment) return { payment, topUp };
      }
    }
    throw new NotFoundException({
      message: 'Payment not found',
      details: { reason: TOPUP_REASON.PAYMENT_NOT_FOUND },
    });
  }

  /** The newest attempt of one provider on an order: retries never run side by side. */
  private async latestPaymentOf(topUpId: string, provider: PaymentProvider) {
    return this.prisma.payment.findFirst({
      where: { coinTopUpId: topUpId, provider },
      orderBy: { createdAt: 'desc' },
      select: PAYMENT_VIEW,
    });
  }

  /** One order with its newest attempt, or null when it never reached a gateway. */
  private async latestPayment(topUpId: string) {
    return this.prisma.payment.findFirst({
      where: { coinTopUpId: topUpId },
      orderBy: { createdAt: 'desc' },
      select: PAYMENT_VIEW,
    });
  }

  async topUpView(topUpId: string | null | undefined) {
    if (!topUpId)
      throw new NotFoundException({ message: 'Top-up not found', details: { reason: TOPUP_REASON.NOT_FOUND } });
    const topUp = await this.prisma.coinTopUp.findUnique({ where: { id: topUpId }, select: ORDER_VIEW });
    if (!topUp)
      throw new NotFoundException({ message: 'Top-up not found', details: { reason: TOPUP_REASON.NOT_FOUND } });
    return orderView(topUp, await this.latestPayment(topUp.id));
  }
}
