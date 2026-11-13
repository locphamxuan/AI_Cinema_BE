import type { Server, Socket } from 'socket.io';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { ROOM_EVENT } from './room-events';
import { WatchRoomScreenGateway } from './watch-room-screen.gateway';

function setup() {
  const prisma = {
    roomParticipant: { findFirst: jest.fn() },
    watchRoom: { findUnique: jest.fn() },
    sessionAdBreak: { findFirst: jest.fn() },
  };
  const gateway = new WatchRoomScreenGateway(prisma as unknown as PrismaService);
  const roomEmit = jest.fn();
  gateway.server = { to: jest.fn(() => ({ emit: roomEmit })) } as unknown as Server;
  const emit = jest.fn();
  const client = { data: { userId: 'host' }, emit } as unknown as Socket;
  return { prisma, gateway, roomEmit, client, emit };
}

describe('WatchRoomScreenGateway', () => {
  it('broadcasts a chat line of a seated member with their name', async () => {
    const { prisma, gateway, roomEmit, client } = setup();
    prisma.roomParticipant.findFirst.mockResolvedValue({ participant: { fullName: 'An' } });
    await gateway.onChat(client, { roomId: 'r1', text: 'hello' });
    expect(roomEmit).toHaveBeenCalledWith(
      ROOM_EVENT.CHAT_MESSAGE,
      expect.objectContaining({ userId: 'host', fullName: 'An', text: 'hello' }),
    );
  });

  it('refuses chat from someone not in the room, and tells the sender why a line was rejected', async () => {
    const { prisma, gateway, roomEmit, client, emit } = setup();
    prisma.roomParticipant.findFirst.mockResolvedValueOnce(null);
    await gateway.onChat(client, { roomId: 'r1', text: 'hello' });
    expect(emit).toHaveBeenCalledWith(ROOM_EVENT.ERROR, { reason: 'NOT_IN_ROOM' });
    prisma.roomParticipant.findFirst.mockResolvedValueOnce({ participant: { fullName: 'An' } });
    await gateway.onChat(client, { roomId: 'r1', text: '  ' });
    expect(emit).toHaveBeenCalledWith(ROOM_EVENT.CHAT_REJECTED, { reason: 'EMPTY' });
    expect(roomEmit).not.toHaveBeenCalled();
  });

  it('shows the Host ad from the Host session to the room, then clears it', async () => {
    const { prisma, gateway, roomEmit, client } = setup();
    prisma.watchRoom.findUnique.mockResolvedValue({ hostUserId: 'host' });
    prisma.sessionAdBreak.findFirst.mockResolvedValue({
      ad: { title: 'Ad', mediaUrl: 'https://cdn/ad.mp4', durationSeconds: 15 },
    });
    await gateway.onAdBreak(client, { roomId: 'r1', active: true, breakId: 'b1' });
    expect(prisma.sessionAdBreak.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'b1', session: { userId: 'host' } } }),
    );
    expect(roomEmit).toHaveBeenLastCalledWith(
      ROOM_EVENT.AD_STATE,
      expect.objectContaining({ active: true, mediaUrl: 'https://cdn/ad.mp4' }),
    );
    await gateway.onAdBreak(client, { roomId: 'r1', active: false });
    expect(roomEmit).toHaveBeenLastCalledWith(ROOM_EVENT.AD_STATE, { active: false });
  });

  it('refuses an ad break that is not in the Host session', async () => {
    const { prisma, gateway, roomEmit, client, emit } = setup();
    prisma.watchRoom.findUnique.mockResolvedValue({ hostUserId: 'host' });
    prisma.sessionAdBreak.findFirst.mockResolvedValue(null);
    await gateway.onAdBreak(client, { roomId: 'r1', active: true, breakId: 'other' });
    expect(emit).toHaveBeenCalledWith(ROOM_EVENT.ERROR, { reason: 'AD_BREAK_NOT_FOUND' });
    expect(roomEmit).not.toHaveBeenCalled();
  });

  it('lets only the Host set the room quality, and only to a rendition name', async () => {
    const { prisma, gateway, roomEmit, client, emit } = setup();
    prisma.watchRoom.findUnique.mockResolvedValue({ hostUserId: 'someone-else' });
    await gateway.onQuality(client, { roomId: 'r1', quality: '720p' });
    expect(emit).toHaveBeenCalledWith(ROOM_EVENT.ERROR, { reason: 'NOT_HOST' });
    prisma.watchRoom.findUnique.mockResolvedValue({ hostUserId: 'host' });
    await gateway.onQuality(client, { roomId: 'r1', quality: 'bogus' });
    expect(emit).toHaveBeenCalledWith(ROOM_EVENT.ERROR, { reason: 'INVALID_QUALITY' });
    await gateway.onQuality(client, { roomId: 'r1', quality: '720p' });
    expect(roomEmit).toHaveBeenCalledWith(ROOM_EVENT.QUALITY_CHANGED, { quality: '720p' });
  });

  it('hands a member who just joined the quality, the running ad and the chat', async () => {
    const { prisma, gateway, client, emit } = setup();
    prisma.roomParticipant.findFirst.mockResolvedValue({ participant: { fullName: 'An' } });
    gateway.screen.setQuality('r1', '480p');
    await gateway.onScreenState(client, { roomId: 'r1' });
    expect(emit).toHaveBeenCalledWith(ROOM_EVENT.SCREEN, { quality: '480p', ad: { active: false }, chat: [] });
  });

  it('ignores a socket the main gateway did not authenticate', async () => {
    const { prisma, gateway, client } = setup();
    (client.data as { userId?: string }).userId = undefined;
    await gateway.onChat(client, { roomId: 'r1', text: 'hi' });
    await gateway.onQuality(client, { roomId: 'r1', quality: '720p' });
    expect(prisma.roomParticipant.findFirst).not.toHaveBeenCalled();
    expect(prisma.watchRoom.findUnique).not.toHaveBeenCalled();
  });
});
