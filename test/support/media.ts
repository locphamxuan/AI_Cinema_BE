import type { Actor, Row } from './api';
import { studioOfEpisode } from './projects';

/** The first bytes of an MP4: the e2e pipeline is mocked, only the signature is checked. */
export const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64)]);

export const DISCLOSURE = {
  aiGeneratedParts: ['video', 'voice'],
  noRealPersonLikeness: true,
  noCopyrightedMaterial: true,
};

/**
 * The studio's delivery on its portal; the mocked pipeline makes it READY (60 s, 1080p). `actor` stands in for the
 * studio only when the episode's project was not made by projectInProduction (e.g. to prove someone else is refused).
 */
export function deliver(actor: Actor, episodeId: string, status = 201) {
  return (studioOfEpisode(episodeId) ?? actor).upload<Row & { version: number; ingestStatus: string }>(
    `/studio-portal/episodes/${episodeId}/media/upload`,
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

const ADMIN_EMAIL = 'admin@aicinema.com';

/**
 * MF-1 §5–6 (07/11/2026): the Reviewer confirms the Final Film (when it is not yet), then the Admin publishes or
 * schedules it. `path` is the publications path of the episode.
 */
export async function release<T = Row>(reviewer: Actor, path: string, body: object = {}, status?: number): Promise<T> {
  const episodeId = path.split('/')[2];
  await reviewer.attempt(`/episodes/${episodeId}/final-confirmation`);
  const admin = await reviewer.signInAs(ADMIN_EMAIL);
  return admin.post<T>(path, body, status);
}

/** Only the Admin takes a release down or cancels it. */
export async function unpublish<T = Row>(anyActor: Actor, path: string, body: object, status?: number): Promise<T> {
  const admin = await anyActor.signInAs(ADMIN_EMAIL);
  return admin.post<T>(path, body, status);
}
