import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { PolicyService } from './policy.service';

const inForce = { id: 'p1', type: 'LEGAL', isActive: true, effectiveFrom: null, effectiveTo: null };

function setup(existing: object | null = inForce, { others = 1, used = 0 } = {}) {
  const policy = {
    findUnique: jest.fn().mockResolvedValue(existing),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(others),
    update: jest.fn().mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: 'p1', ...data })),
    create: jest.fn().mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: 'p2', ...data })),
    delete: jest.fn().mockResolvedValue(existing),
  };
  const db = { policy, $executeRaw: jest.fn().mockResolvedValue(1) };
  const prisma = {
    ...db,
    aiContentLabel: { count: jest.fn().mockResolvedValue(used) },
    complianceCheck: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>) => work(db)),
  };
  return { service: new PolicyService(prisma as unknown as PrismaService), policy, db };
}

describe('PolicyService', () => {
  it('stores the plain-text content as sent and is active by default', async () => {
    const { service, policy } = setup();
    await service.create({ name: 'N', type: 'AI_LABELING', version: '1.0.0', content: 'Dòng 1\n- ý a' });
    expect(policy.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ content: 'Dòng 1\n- ý a', isActive: true, effectiveFrom: null }) as object,
    });
  });

  it('refuses an end date that is not after the start date', async () => {
    const { service } = setup();
    const body = { name: 'N', type: 'LEGAL' as const, version: '1', content: 'x' };
    await expect(
      service.create({ ...body, effectiveFrom: '2026-05-02T00:00:00Z', effectiveTo: '2026-05-01T00:00:00Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('switches a policy off without touching any other column when another one of its type is in force', async () => {
    const { service, policy } = setup();
    await service.update('p1', { isActive: false });
    expect(policy.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { isActive: false } });
    expect(policy.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ type: 'LEGAL', id: { not: 'p1' }, isActive: true }) as object,
    });
  });

  it('refuses to switch off or retype the last policy of its type in force', async () => {
    const { service, policy } = setup(inForce, { others: 0 });
    await expect(service.update('p1', { isActive: false })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.update('p1', { type: 'CONTENT_POLICY' })).rejects.toBeInstanceOf(ConflictException);
    expect(policy.update).not.toHaveBeenCalled();
  });

  it('serialises the last-in-force check per type, so two Admins cannot both switch off the last two', async () => {
    const { service, db } = setup();
    await service.update('p1', { isActive: false });
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('refuses to date the last policy of its type out of force, either end', async () => {
    const { service, policy } = setup(inForce, { others: 0 });
    for (const dates of [{ effectiveTo: '2020-01-01T00:00:00Z' }, { effectiveFrom: '2999-01-01T00:00:00Z' }]) {
      await expect(service.update('p1', dates)).rejects.toMatchObject({
        response: { details: { reason: 'POLICY_LAST_IN_FORCE' } },
      });
    }
    expect(policy.update).not.toHaveBeenCalled();
  });

  it('refuses an unknown type or a non-boolean isActive in the list filter', async () => {
    const { service } = setup();
    await expect(service.findAll({ path: '/policies', filter: { type: '$eq:COPYRIGHT' } })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.findAll({ path: '/policies', filter: { isActive: '$eq:yes' } })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('switches off a policy that is already out of its dates without the guard', async () => {
    const { service, policy } = setup({ ...inForce, effectiveTo: new Date('2020-01-01') }, { others: 0 });
    await service.update('p1', { isActive: false });
    expect(policy.update).toHaveBeenCalled();
  });

  it('refuses to delete a policy recorded by labels or compliance checks', async () => {
    const { service, policy } = setup(inForce, { used: 3 });
    await expect(service.remove('p1')).rejects.toBeInstanceOf(ConflictException);
    expect(policy.delete).not.toHaveBeenCalled();
  });

  it('deletes an unused policy', async () => {
    const { service, policy } = setup({ ...inForce, isActive: false });
    await service.remove('p1');
    expect(policy.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
  });

  it('lists the policies in force, by type', async () => {
    const { service, policy } = setup();
    await service.inForce();
    expect(policy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }) as object,
        orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
      }),
    );
  });

  it('refuses to update a policy that does not exist', async () => {
    const { service } = setup(null);
    await expect(service.update('nope', { isActive: true })).rejects.toBeInstanceOf(NotFoundException);
  });
});
