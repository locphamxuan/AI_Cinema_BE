// Builds AI_Film/CATALOG.json, the list of films `npm run seed:catalog` puts into the catalog.
//   npm run film:catalog   (after `npm run film:push`, so every video is already on R2)
// A film is a folder "<genre> - <genre>/<title>/" of episodes "...ep1.mp4"; a video straight in AI_Film_v2 is a
// one-episode film described in ROOT_FILMS. For each film it measures the episodes with ffmpeg, takes a poster
// (the .jpg beside the video, else a frame of episode 1), uploads the poster next to the videos on R2 and
// writes the public URLs. Synopsis and year can be set by hand in catalog-meta.json ({ "<title>": {...} }).
// Needs ffmpeg on PATH and the S3_* settings of .env.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const root = path.dirname(fileURLToPath(import.meta.url));
const library = path.join(root, 'AI_Film_v2');
const PREFIX = 'ai-film/';
const VIDEO = /\.(mp4|mov|mkv)$/i;
const DEFAULT_YEAR = 2026;

/** Videos lying straight in AI_Film_v2: no folder tells their title or genres. */
const ROOT_FILMS = {
  '#phimhaymoingay #phimai [7693915943465930005].mp4': { title: 'Phim hay mỗi ngày', genres: ['Phim ngắn'] },
  'She Raised a Monster They Tried to Kill [iXpEcPsswpU].mp4': {
    title: 'She Raised a Monster They Tried to Kill',
    genres: ['Giả tưởng', 'Phiêu lưu'],
    language: 'en',
    synopsis:
      'Sau khi thợ săn giết mẹ của một sinh vật nhỏ bí ẩn, Elara liều mình cứu đứa con của nó, Kiro, nhưng nỗi sợ hãi khiến cả hai bị xua khỏi ngôi làng từng là nhà. Nhiều năm sau, khi một con quái vật cổ xưa thức giấc dưới lòng núi, Kiro phải đưa ra lựa chọn.',
  },
};

function need(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is empty: set it in .env (the same R2 settings the BE uses)`);
  return value;
}

const s3 = new S3Client({
  region: process.env.S3_REGION?.trim() || 'auto',
  endpoint: need('S3_ENDPOINT'),
  credentials: { accessKeyId: need('S3_ACCESS_KEY_ID'), secretAccessKey: need('S3_SECRET_ACCESS_KEY') },
});
const publicBase = need('S3_PUBLIC_BASE_URL').replace(/\/+$/, '');
const publicUrl = (key) => `${publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`;
const rel = (full) => path.relative(root, full).split(path.sep).join('/');

function slug(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Duration (s), width and height of a video, read from ffmpeg's banner. */
function probe(file) {
  let banner = '';
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    banner = String(error.stderr ?? '');
  }
  const time = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(banner);
  const size = /Video:.*?, (\d{2,5})x(\d{2,5})/.exec(banner);
  if (!time) throw new Error(`ffmpeg could not read ${file}`);
  return {
    duration: Math.max(1, Math.round(Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]))),
    width: size ? Number(size[1]) : null,
    height: size ? Number(size[2]) : null,
  };
}

async function remoteSize(key) {
  try {
    return (await s3.send(new HeadObjectCommand({ Bucket: need('S3_BUCKET'), Key: key }))).ContentLength;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return null;
    throw error;
  }
}

async function uploadPoster(movieSlug, firstEpisode, besideJpg, work) {
  let file = besideJpg;
  if (!file) {
    file = path.join(work, `${movieSlug}.jpg`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '3', '-i', firstEpisode, '-frames:v', '1', '-vf', 'scale=720:-2', file]);
  }
  const key = `${PREFIX}posters/${movieSlug}.jpg`;
  await s3.send(
    new PutObjectCommand({ Bucket: need('S3_BUCKET'), Key: key, Body: readFileSync(file), ContentType: 'image/jpeg' }),
  );
  return publicUrl(key);
}

const episodeNumber = (name) => Number(/ep\s*\.?\s*(\d+)/i.exec(name)?.[1] ?? 1);

/** Every film of the library as { title, genres, files (episode order), jpg?, overrides }. */
function films() {
  const found = [];
  for (const entry of readdirSync(library, { withFileTypes: true })) {
    const full = path.join(library, entry.name);
    if (entry.isFile() && ROOT_FILMS[entry.name]) {
      const jpg = full.replace(VIDEO, '.jpg');
      found.push({ ...ROOT_FILMS[entry.name], files: [full], jpg: existsSync(jpg) ? jpg : null });
    }
    if (!entry.isDirectory()) continue;
    const genres = entry.name.split(' - ').map((g) => g.trim()).filter(Boolean);
    for (const movie of readdirSync(full, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const dir = path.join(full, movie.name);
      const files = readdirSync(dir)
        .filter((name) => VIDEO.test(name))
        .sort((a, b) => episodeNumber(a) - episodeNumber(b) || a.localeCompare(b, 'vi'))
        .map((name) => path.join(dir, name));
      if (files.length) found.push({ title: movie.name, genres, files, jpg: null });
    }
  }
  return found.sort((a, b) => a.title.localeCompare(b.title, 'vi'));
}

async function main() {
  const metaPath = path.join(root, 'catalog-meta.json');
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
  const work = mkdtempSync(path.join(tmpdir(), 'film-catalog-'));
  const movies = [];
  try {
    for (const film of films()) {
      const movieSlug = slug(film.title);
      const episodes = [];
      for (const [index, file] of film.files.entries()) {
        const key = PREFIX + rel(file);
        const size = statSync(file).size;
        if ((await remoteSize(key)) !== size) throw new Error(`${rel(file)} is not on R2 yet: run npm run film:push`);
        episodes.push({ number: index + 1, title: `Tập ${index + 1}`, file: rel(file), url: publicUrl(key), size, ...probe(file) });
      }
      const extra = meta[film.title] ?? {};
      const genreText = film.genres.join(', ').toLowerCase();
      movies.push({
        title: film.title,
        slug: movieSlug,
        genres: film.genres,
        language: film.language ?? 'vi',
        releaseYear: extra.releaseYear ?? DEFAULT_YEAR,
        synopsis:
          extra.synopsis ??
          film.synopsis ??
          `${film.title} — phim AI thể loại ${genreText}, ${episodes.length} tập. Hình ảnh và âm thanh được tạo bằng AI.`,
        posterUrl: await uploadPoster(movieSlug, film.files[0], film.jpg, work),
        episodes,
      });
      console.log(`ok  ${film.title} (${episodes.length} tập)`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  writeFileSync(path.join(root, 'CATALOG.json'), `${JSON.stringify({ movies }, null, 2)}\n`);
  console.log(`${movies.length} films written to AI_Film/CATALOG.json; now run npm run seed:catalog.`);
}

await main();
