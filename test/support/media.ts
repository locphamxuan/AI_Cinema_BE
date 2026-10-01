import type { Actor, Row } from './api';

/** The first bytes of an MP4: the e2e pipeline is mocked, only the signature is checked. */
export const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64)]);

export const DISCLOSURE = {
  aiTools: ['Kling', 'ElevenLabs'],
  aiGeneratedParts: ['video', 'voice'],
  humanEdited: true,
  noRealPersonLikeness: true,
  noCopyrightedMaterial: true,
};

/** The studio's delivery uploaded by the Creator; the mocked pipeline makes it READY (60 s, 1080p). */
export function deliver(creator: Actor, episodeId: string, status = 201) {
  return creator.upload<Row & { version: number; ingestStatus: string }>(
    `/episodes/${episodeId}/media/upload`,
    { field: 'file', name: 'tap.mp4', content: MP4 },
    { aiDisclosure: JSON.stringify(DISCLOSURE), proposedLabelType: 'AI_GENERATED' },
    status,
  );
}
