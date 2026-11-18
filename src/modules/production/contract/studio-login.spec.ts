import { ConflictException } from '@nestjs/common';
import type { PrismaTx } from 'src/infrastructure/prisma/prisma.service';
import { assertStudioCanSign } from './studio-login';

const count = jest.fn();
const txWith = (n: number) => {
  count.mockResolvedValue(n);
  return { user: { count } } as unknown as PrismaTx;
};

describe('assertStudioCanSign', () => {
  it('lets a studio with an active login account receive the contract', async () => {
    const tx = txWith(1);
    await expect(assertStudioCanSign(tx, 's1', 'Studio A')).resolves.toBeUndefined();
    expect(count).toHaveBeenCalledWith({ where: { studioId: 's1', role: 'STUDIO', isActive: true } });
  });

  it('refuses a studio nobody can sign in for, naming the reason the screens act on', async () => {
    const refusal = assertStudioCanSign(txWith(0), 's1', 'Studio A');
    await expect(refusal).rejects.toBeInstanceOf(ConflictException);
    await expect(refusal).rejects.toMatchObject({
      response: { details: { reason: 'STUDIO_HAS_NO_LOGIN', studioId: 's1' } },
    });
  });
});
