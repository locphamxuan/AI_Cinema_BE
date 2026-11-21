import { EpisodeStatus, LabelType, MediaIngestStatus, MediaSourceMethod, type PrismaClient } from '@prisma/client';
import type { CatalogEpisode } from './demo-data';

/** The studio delivers an episode as the team's R2 file, already playable (no transcoding in the demo). */
export async function deliverFromR2(
  prisma: PrismaClient,
  delivery: { episodeId: string; studioUserId: string; source: CatalogEpisode; note: string },
): Promise<string> {
  const { episodeId, studioUserId, source, note } = delivery;
  const asset = await prisma.mediaAsset.create({
    data: {
      episodeId,
      version: 1,
      sourceMethod: MediaSourceMethod.REMOTE_FILE,
      sourceUrl: source.url,
      streamUrl: source.url,
      isSelfHosted: true,
      qualities: source.height ? [`${source.height}p`] : [],
      durationSeconds: Math.round(source.duration),
      fileSizeBytes: BigInt(source.size),
      ingestStatus: MediaIngestStatus.READY,
      aiDisclosure: { aiGeneratedParts: ['video', 'audio'], noRealPersonLikeness: true, noCopyrightedMaterial: true },
      proposedLabelType: LabelType.AI_GENERATED,
      submissionNote: note,
      submittedById: studioUserId,
    },
  });
  await prisma.episode.update({ where: { id: episodeId }, data: { status: EpisodeStatus.IN_REVIEW } });
  return asset.id;
}
