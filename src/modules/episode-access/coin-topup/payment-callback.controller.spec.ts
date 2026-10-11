import type { Response } from 'express';
import { PaymentCallbackController } from './payment-callback.controller';
import type { CoinTopUpService } from './coin-topup.service';
import type { PaymentGatewayService } from './gateways/payment-gateway.service';
import type { AppConfig } from 'src/config/app-config';

describe('PaymentCallbackController VNPay return', () => {
  const order = { topUpId: 'topup-id', status: 'PENDING' };

  function setup(appReturnUrl?: string) {
    const topUps = {
      handleVnpayIpn: jest.fn().mockResolvedValue({ RspCode: '00', Message: 'Confirm Success' }),
      findForReturn: jest.fn().mockResolvedValue(order),
    } as unknown as CoinTopUpService;
    const gateways = {
      verifyCallbackSignature: jest.fn().mockReturnValue(true),
    } as unknown as PaymentGatewayService;
    const config = {
      webAppUrl: 'https://web.example.com',
      payments: { vnpay: { appReturnUrl } },
    } as unknown as AppConfig;
    const controller = new PaymentCallbackController(topUps, gateways, config);
    const res = {
      redirect: jest.fn(),
      status: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      send: jest.fn(),
    } as unknown as Response;
    return { controller, topUps, gateways, res };
  }

  it('returns a bridge page linking back into the mobile app with the looked-up order', async () => {
    const { controller, topUps, res } = setup('aicinema://');

    await controller.returnToApp('vnpay', { vnp_TxnRef: 'VNPAY-TXN' }, res);

    expect(topUps.handleVnpayIpn).toHaveBeenCalledWith({ vnp_TxnRef: 'VNPAY-TXN' });
    expect(topUps.findForReturn).toHaveBeenCalledWith('VNPAY', { providerTxnId: 'VNPAY-TXN' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.type).toHaveBeenCalledWith('html');
    const html = (res.send as jest.Mock).mock.calls[0][0] as string;
    expect(html).toContain('aicinema://wallet/top-ups?topUpId=topup-id&amp;status=PENDING&amp;provider=VNPAY');
    expect(html).toContain('window.location.href = "aicinema://wallet/top-ups?topUpId=topup-id&status=PENDING&provider=VNPAY"');
    expect(html).toContain('Mở lại ứng dụng ngay');
    expect(html).toContain('Đang xác nhận thanh toán');
  });

  it('keeps the existing web return when no app deep link is configured', async () => {
    const { controller, res } = setup();

    await controller.returnToApp('vnpay', { vnp_TxnRef: 'VNPAY-TXN' }, res);

    expect(res.redirect).toHaveBeenCalledWith(
      'https://web.example.com/wallet/top-ups/topup-id?status=PENDING&provider=VNPAY',
    );
    expect(res.send).not.toHaveBeenCalled();
  });

  it('does not look up an order when the VNPay return signature is invalid', async () => {
    const { controller, gateways, topUps, res } = setup('aicinema://');
    (gateways.verifyCallbackSignature as jest.Mock).mockReturnValue(false);

    await controller.returnToApp('vnpay', { vnp_TxnRef: 'VNPAY-TXN' }, res);

    expect(topUps.findForReturn).not.toHaveBeenCalled();
    expect(topUps.handleVnpayIpn).not.toHaveBeenCalled();
    const html = (res.send as jest.Mock).mock.calls[0][0] as string;
    expect(html).toContain('aicinema://wallet/top-ups?status=FAILED&amp;provider=VNPAY');
    expect(html).toContain('Thanh toán chưa thành công');
  });
});
