/**
 * Watch Party wire protocol (BR-69): every WebSocket event the room gateway sends or receives,
 * plus the limits the edge-case review of 2026-11-11 fixed. Keeping them here lets the service,
 * the gateway and the tests speak the same names.
 */
export const ROOM_EVENT = {
  // Client → server
  JOIN: 'ROOM_JOIN',
  PLAYBACK: 'ROOM_PLAYBACK',
  INVITE: 'ROOM_INVITE',
  LEAVE: 'ROOM_LEAVE',
  VOTE_HOST: 'ROOM_VOTE_HOST',
  // Shared screen (13/11/2026): chat, the Host's ad, the Host's quality, and the catch-up snapshot.
  CHAT: 'ROOM_CHAT',
  AD_BREAK: 'ROOM_AD_BREAK',
  QUALITY: 'ROOM_QUALITY',
  SCREEN_STATE: 'ROOM_SCREEN_STATE',
  // Server → clients
  JOINED: 'ROOM_JOINED',
  PARTICIPANT_JOINED: 'ROOM_PARTICIPANT_JOINED',
  PARTICIPANT_LEFT: 'ROOM_PARTICIPANT_LEFT',
  SYNC_PLAYBACK: 'SYNC_PLAYBACK',
  HEARTBEAT_SYNC: 'HEARTBEAT_SYNC',
  HOST_DISCONNECTED: 'ROOM_HOST_DISCONNECTED',
  HOST_RECONNECTED: 'ROOM_HOST_RECONNECTED',
  HOST_CHANGED: 'ROOM_HOST_CHANGED',
  HOST_INACTIVE: 'ROOM_HOST_INACTIVE',
  VOTE_OPEN: 'ROOM_VOTE_OPEN',
  EPISODE_ENDED: 'ROOM_EPISODE_ENDED',
  EPISODE_CHANGED: 'ROOM_EPISODE_CHANGED',
  ENTITLEMENT_REQUIRED: 'ROOM_ENTITLEMENT_REQUIRED',
  TERMINATED: 'ROOM_TERMINATED',
  SESSION_REPLACED: 'ROOM_SESSION_REPLACED',
  INVITED: 'ROOM_INVITED',
  INVITE_SENT: 'ROOM_INVITE_SENT',
  INVITE_FAILED: 'ROOM_INVITE_FAILED',
  LAST_ONE_LEFT: 'ROOM_LAST_ONE_LEFT',
  CHAT_MESSAGE: 'ROOM_CHAT_MESSAGE',
  CHAT_REJECTED: 'ROOM_CHAT_REJECTED',
  AD_STATE: 'ROOM_AD_STATE',
  QUALITY_CHANGED: 'ROOM_QUALITY_CHANGED',
  SCREEN: 'ROOM_SCREEN',
  ERROR: 'ROOM_ERROR',
} as const;

/** Why a room was force-closed for everyone (edge 1.4, 3.2). */
export const ROOM_TERMINATED_REASON = {
  EPISODE_TAKEN_DOWN: 'EPISODE_TAKEN_DOWN',
  HOST_DISBANDED: 'HOST_DISBANDED',
  HOST_LEFT: 'HOST_LEFT',
  EXPIRED: 'EXPIRED',
} as const;

/** Room capacity: a student watch party of family and friends, never a broadcast (edge 4.2). */
export const ROOM_CAPACITY = 8;

/** Join-by-code brute force (edge 4.1): 5 wrong codes in 10 minutes lock the caller out 15 minutes. */
export const CODE_GUESS_LIMIT = 5;
export const CODE_GUESS_WINDOW_MS = 10 * 60 * 1000;
export const CODE_GUESS_LOCK_MS = 15 * 60 * 1000;

/** Host lifecycle (edges 3.1, 3.3): the grace after a drop, and the pause that opens a vote. */
export const HOST_GRACE_MS = 45_000;
export const HOST_PAUSE_WARN_MS = 5 * 60 * 1000;
export const HOST_VOTE_OPEN_MS = HOST_PAUSE_WARN_MS + 60_000;

/** Sync cadence (edge 2.2) and the Host seek throttle (edge 2.3). */
export const HEARTBEAT_MS = 5_000;
export const SEEK_THROTTLE_MS = 500;

/** Friend invites (edges 7.1, 7.2): one invite per friend per minute, each valid 10 minutes. */
export const INVITE_COOLDOWN_MS = 60_000;
export const INVITE_TTL_MS = 10 * 60 * 1000;

export const ROOM_CHANNEL = (roomId: string) => `room:${roomId}`;
export const USER_CHANNEL = (userId: string) => `user:${userId}`;
