import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FriendshipStatus } from '@prisma/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { CreateFriendshipDto } from './dto/create-friendship.dto';
import { FriendshipResponseDto } from './dto/friendship-response.dto';

/** 60 s cooldown between two invites to the same friend (BR-69). */
const INVITE_COOLDOWN_MS = 60_000;

@Injectable()
export class FriendshipService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateFriendshipDto): Promise<FriendshipResponseDto> {
    if (dto.receiverId === userId) {
      throw new ForbiddenException({ message: 'Cannot befriend yourself', details: { reason: 'SELF_FRIEND' } });
    }
    const receiver = await this.prisma.user.findUnique({ where: { id: dto.receiverId } });
    if (!receiver) throw new NotFoundException({ message: 'User not found', details: { reason: 'USER_NOT_FOUND' } });
    if (receiver.role !== 'MEMBER' || receiver.isActive === false) {
      throw new ForbiddenException({ message: 'Can only befriend active members', details: { reason: 'NOT_A_MEMBER' } });
    }

    const existing = await this.prisma.friendship.findUnique({
      where: { senderId_receiverId: { senderId: userId, receiverId: dto.receiverId } },
    });
    if (existing) {
      if (existing.status === FriendshipStatus.PENDING) {
        throw new ConflictException({ message: 'Friend request already sent', details: { reason: 'ALREADY_PENDING' } });
      }
      if (existing.status === FriendshipStatus.ACCEPTED) {
        throw new ConflictException({ message: 'Already friends', details: { reason: 'ALREADY_FRIENDS' } });
      }
    }

    const now = new Date();
    if (existing?.lastInviteAt && now.getTime() - existing.lastInviteAt.getTime() < INVITE_COOLDOWN_MS) {
      throw new ConflictException({ message: 'Invite cooldown not elapsed', details: { reason: 'COOLDOWN' } });
    }

    const row = await this.prisma.friendship.create({
      data: { senderId: userId, receiverId: dto.receiverId, lastInviteAt: dto.inviteContext ? now : null },
    });
    return FriendshipResponseDto.from(row);
  }

  async respond(userId: string, friendshipId: string, accept: boolean): Promise<FriendshipResponseDto> {
    const row = await this.prisma.friendship.findUnique({ where: { id: friendshipId } });
    if (!row) throw new NotFoundException({ message: 'Friend request not found', details: { reason: 'NOT_FOUND' } });
    if (row.receiverId !== userId) {
      throw new ForbiddenException({ message: 'Only the receiver may answer', details: { reason: 'NOT_RECEIVER' } });
    }
    if (row.status !== FriendshipStatus.PENDING) {
      throw new ConflictException({ message: 'Friend request already answered', details: { reason: 'NOT_PENDING' } });
    }
    const updated = await this.prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: accept ? FriendshipStatus.ACCEPTED : FriendshipStatus.BLOCKED, respondedAt: new Date() },
    });
    return FriendshipResponseDto.from(updated);
  }

  async list(userId: string, status?: FriendshipStatus): Promise<FriendshipResponseDto[]> {
    const rows = await this.prisma.friendship.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
        ...(status ? { status } : {}),
      },
      include: { sender: { select: { id: true, fullName: true } }, receiver: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => FriendshipResponseDto.from(r));
  }

  async block(userId: string, friendId: string): Promise<FriendshipResponseDto> {
    if (friendId === userId) throw new ForbiddenException({ message: 'Cannot block yourself', details: { reason: 'SELF_BLOCK' } });
    const row = await this.prisma.friendship.upsert({
      where: { senderId_receiverId: { senderId: userId, receiverId: friendId } },
      update: { status: FriendshipStatus.BLOCKED, respondedAt: new Date() },
      create: { senderId: userId, receiverId: friendId, status: FriendshipStatus.BLOCKED, respondedAt: new Date() },
    });
    return FriendshipResponseDto.from(row);
  }

  async unblock(userId: string, friendId: string): Promise<void> {
    await this.prisma.friendship.delete({
      where: { senderId_receiverId: { senderId: userId, receiverId: friendId } },
    });
  }

  /** The friends the Host may invite into a room (online status comes from the gateway). */
  async acceptedFriends(userId: string): Promise<{ id: string; fullName: string }[]> {
    const rows = await this.prisma.friendship.findMany({
      where: { status: FriendshipStatus.ACCEPTED, OR: [{ senderId: userId }, { receiverId: userId }] },
      include: { sender: { select: { id: true, fullName: true } }, receiver: { select: { id: true, fullName: true } } },
    });
    return rows.map((r) => (r.senderId === userId ? r.receiver : r.sender));
  }
}