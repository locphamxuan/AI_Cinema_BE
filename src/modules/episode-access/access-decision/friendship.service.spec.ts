import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FriendshipStatus } from '@prisma/client';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { FriendshipService } from './friendship.service';
import { FriendshipResponseDto } from './dto/friendship-response.dto';

describe('FriendshipService', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    friendship: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), upsert: jest.fn(), delete: jest.fn() },
  };
  const service = new FriendshipService(prisma as unknown as PrismaService);

  const member = (overrides: Record<string, unknown> = {}) => ({
    id: 'u2', fullName: 'B', role: 'MEMBER', isActive: true, ...overrides,
  });

  beforeEach(() => jest.clearAllMocks());

  it('refuses to befriend yourself', async () => {
    await expect(service.create('u1', { receiverId: 'u1' })).rejects.toThrow(ForbiddenException);
  });

  it('refuses when the receiver is not an active member', async () => {
    prisma.user.findUnique.mockResolvedValue(member({ role: 'STAFF' }));
    await expect(service.create('u1', { receiverId: 'u2' })).rejects.toThrow(ForbiddenException);
  });

  it('creates a pending friendship and records the invite timestamp', async () => {
    prisma.user.findUnique.mockResolvedValue(member());
    prisma.friendship.findUnique.mockResolvedValue(null);
    prisma.friendship.create.mockResolvedValue({
      id: 'f1', senderId: 'u1', receiverId: 'u2', status: FriendshipStatus.PENDING,
      respondedAt: null, lastInviteAt: new Date('2026-11-11T00:00:00Z'), createdAt: new Date(), updatedAt: new Date(),
    });
    const res = await service.create('u1', { receiverId: 'u2', inviteContext: { roomId: 'r1' } });
expect(prisma.friendship.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ senderId: 'u1', receiverId: 'u2', lastInviteAt: expect.any(Date) }),
      }),
    );
    expect(res).toBeInstanceOf(FriendshipResponseDto);
    expect(res.status).toBe('PENDING');
  });

  it('refuses a second request while one is pending', async () => {
    prisma.user.findUnique.mockResolvedValue(member());
    prisma.friendship.findUnique.mockResolvedValue({ status: FriendshipStatus.PENDING });
    await expect(service.create('u1', { receiverId: 'u2' })).rejects.toThrow(ConflictException);
  });

  it('only the receiver may answer', async () => {
    prisma.friendship.findUnique.mockResolvedValue({ id: 'f1', receiverId: 'u2', status: FriendshipStatus.PENDING });
    await expect(service.respond('u1', 'f1', true)).rejects.toThrow(ForbiddenException);
  });

  it('accepts and marks the friendship ACCEPTED', async () => {
    prisma.friendship.findUnique.mockResolvedValue({ id: 'f1', receiverId: 'u2', status: FriendshipStatus.PENDING });
    prisma.friendship.update.mockResolvedValue({
      id: 'f1', senderId: 'u1', receiverId: 'u2', status: FriendshipStatus.ACCEPTED,
      respondedAt: new Date(), lastInviteAt: null, createdAt: new Date(), updatedAt: new Date(),
    });
    const res = await service.respond('u2', 'f1', true);
    expect(prisma.friendship.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: FriendshipStatus.ACCEPTED }) }),
    );
    expect(res.status).toBe('ACCEPTED');
  });

  it('blocks when answered with false', async () => {
    prisma.friendship.findUnique.mockResolvedValue({ id: 'f1', receiverId: 'u2', status: FriendshipStatus.PENDING });
    prisma.friendship.update.mockResolvedValue({
      id: 'f1', senderId: 'u1', receiverId: 'u2', status: FriendshipStatus.BLOCKED,
      respondedAt: new Date(), lastInviteAt: null, createdAt: new Date(), updatedAt: new Date(),
    });
    const res = await service.respond('u2', 'f1', false);
    expect(res.status).toBe('BLOCKED');
  });

  it('returns 404 for a missing friendship', async () => {
    prisma.friendship.findUnique.mockResolvedValue(null);
    await expect(service.respond('u2', 'missing', true)).rejects.toThrow(NotFoundException);
  });
});