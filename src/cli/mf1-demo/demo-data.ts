import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContractPartySettingsDto } from 'src/modules/platform/platform-setting/dto/contract-party-settings.dto';
import type { UpdateStudioRequestDto } from 'src/modules/production/studio/dto/studio.request.dto';

/** One film of the team's R2 catalogue (AI_Film/CATALOG.json): what the demo project is named after and delivers. */
export interface CatalogEpisode {
  number: number;
  title: string;
  url: string;
  size: number;
  duration: number;
  height?: number;
}

export interface CatalogMovie {
  title: string;
  genres: string[];
  synopsis: string;
  episodes: CatalogEpisode[];
}

/** prisma/demo/mf1-demo.json: every value the MF-1 demo shows; the seed code holds none of it. */
export interface Mf1DemoData {
  prefix: string;
  people: { admin: string; reviewer: string; creator: string; studio: string };
  platformParty: ContractPartySettingsDto;
  studioProfile: UpdateStudioRequestDto;
  project: {
    budgetVnd: number;
    budgetReason: string;
    ageRating: string;
    episodeCount: number;
    firstDeadlineInDays: number;
    daysBetweenDeadlines: number;
    releaseStartInDays: number;
    releaseEndInDays: number;
    notes: ['admin' | 'creator', string][];
    scriptNote: string;
    reviewComment: string;
    finalComment: string;
    deliveryNote: string;
    aiLabelText: string;
  };
  /** [title, summary] of each project: project N stops at milestone N. */
  stages: [string, string][];
}

const readJson = <T>(...path: string[]) => JSON.parse(readFileSync(join(process.cwd(), ...path), 'utf8')) as T;

/** The first catalogue film with enough episodes for the demo project. */
export function pickFilm(movies: CatalogMovie[], episodeCount: number): CatalogMovie {
  const film = movies.find((m) => m.episodes.length >= episodeCount);
  if (!film) throw new Error(`AI_Film/CATALOG.json has no film with ${episodeCount} episodes`);
  return film;
}

export function loadDemoData(): { data: Mf1DemoData; film: CatalogMovie } {
  const data = readJson<Mf1DemoData>('prisma', 'demo', 'mf1-demo.json');
  const { movies } = readJson<{ movies: CatalogMovie[] }>('AI_Film', 'CATALOG.json');
  return { data, film: pickFilm(movies, data.project.episodeCount) };
}

/** yyyy-mm-dd, `days` from today. */
export const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** The signed PDF as multer hands it to the signing services. */
export const asUpload = (buffer: Buffer, name: string) =>
  ({ buffer, originalname: name, mimetype: 'application/pdf', size: buffer.length }) as Express.Multer.File;
