import { BadRequestException, ConflictException } from '@nestjs/common';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { StudioService } from './studio.service';

const user = { id: 'user-1' } as AuthenticatedUser;
const active = { id: 'studio-1', name: 'Studio A', email: 'a@studio.ai', isActive: true };

function build(known: typeof active | null) {
  const prisma = {
    studio: {
      findUnique: jest.fn().mockResolvedValue(known),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: 'new', isActive: true, ...data })),
    },
    $transaction: jest.fn().mockImplementation((work: (tx: unknown) => unknown) => work(prisma)),
  };
  const auditLog = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new StudioService(
    prisma as unknown as ConstructorParameters<typeof StudioService>[0],
    auditLog as unknown as ConstructorParameters<typeof StudioService>[1],
  );
  return { service, prisma };
}

describe('StudioService.resolve (studio typed by hand at hand-off)', () => {
  it('creates a studio for a new email', async () => {
    const { service, prisma } = build(null);
    const studio = await service.resolve({ studioName: 'Studio B', studioEmail: 'b@studio.ai' }, null, user);
    expect(studio.id).toBe('new');
    expect(prisma.studio.create).toHaveBeenCalledTimes(1);
  });

  it('reuses the studio already on record for a known email', async () => {
    const { service, prisma } = build(active);
    prisma.studio.findUnique.mockResolvedValue(active);
    const studio = await service.resolve({ studioName: 'Other', studioEmail: active.email }, null, user);
    expect(studio.id).toBe(active.id);
    expect(prisma.studio.create).not.toHaveBeenCalled();
  });

  it('needs a name when the email is new', async () => {
    const { service } = build(null);
    await expect(service.resolve({ studioEmail: 'b@studio.ai' }, null, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('needs a typed studio when the project has none', async () => {
    const { service } = build(null);
    await expect(service.resolve({}, null, user)).rejects.toBeInstanceOf(ConflictException);
  });

  it('falls back to the project studio', async () => {
    const { service, prisma } = build(active);
    prisma.studio.findUnique.mockResolvedValue(active);
    expect((await service.resolve({}, active.id, user)).id).toBe(active.id);
  });
});
