import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { PolicyService } from './policy.service';

function setup(existing: object | null = { id: 'p1' }) {
  const policy = {
    findUnique: jest.fn().mockResolvedValue(existing),
    update: jest.fn().mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: 'p1', ...data })),
    create: jest.fn().mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: 'p2', ...data })),
  };
  const service = new PolicyService({ policy } as unknown as PrismaService);
  return { service, policy };
}

describe('PolicyService', () => {
  it('switches a policy off without touching any other column', async () => {
    const { service, policy } = setup();
    await service.update('p1', { isActive: false });
    expect(policy.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { isActive: false } });
  });

  it('clears the JSON content with a database NULL', async () => {
    const { service, policy } = setup();
    await service.update('p1', { content: null });
    expect(policy.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { content: Prisma.DbNull } });
  });

  it('creates a policy without content as a database NULL and active by default', async () => {
    const { service, policy } = setup();
    await service.create({ name: 'N', type: 'AI_LABELING', version: '1.0.0' });
    expect(policy.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ content: Prisma.DbNull, isActive: true, effectiveFrom: null }) as object,
    });
  });

  it('refuses to update a policy that does not exist', async () => {
    const { service } = setup(null);
    await expect(service.update('nope', { isActive: true })).rejects.toBeInstanceOf(NotFoundException);
  });
});
