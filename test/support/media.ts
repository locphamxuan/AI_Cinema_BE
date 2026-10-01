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

/** Delivered, approved, labeled and compliance-checked: ready to be priced and released. */
export async function compliantEpisode(reviewer: Actor, creator: Actor, episodeId: string) {
  const asset = await deliver(creator, episodeId);
  await reviewer.post(`/media-assets/${asset.id}/reviews`, { decision: 'APPROVED' }, 200);
  await reviewer.post(
    `/media-assets/${asset.id}/ai-content-labels`,
    { labelType: 'AI_GENERATED', labelText: 'Phim được tạo bằng trí tuệ nhân tạo (AI)' },
    200,
  );
  await reviewer.post(
    `/media-assets/${asset.id}/compliance-checks`,
    { decree142Notice: { result: 'PASS' }, contentSafety: { result: 'PASS' }, depictsRealPersonOrEvent: false },
    200,
  );
  return asset;
}
