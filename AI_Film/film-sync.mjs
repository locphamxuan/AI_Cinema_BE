// Shares the films of AI_Film through the project's R2 bucket (the videos are too big for git).
//   npm run film:push   upload the videos that are new, then rewrite MANIFEST.json / MANIFEST.md (commit those)
//   npm run film:pull   download the videos listed in MANIFEST.json that this machine lacks
//   npm run film:list   show what a pull would download, without downloading
// Needs S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY in .env (the ones the BE uses).
import { createReadStream, createWriteStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const root = path.dirname(fileURLToPath(import.meta.url));
const PREFIX = 'ai-film/';
const VIDEO = /\.(mp4|mov|mkv)$/i;
const MB = 1024 * 1024;

function need(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is empty: set it in .env (the same R2 settings the BE uses)`);
  return value;
}

function client() {
  return new S3Client({
    region: process.env.S3_REGION?.trim() || 'auto',
    endpoint: need('S3_ENDPOINT'),
    credentials: { accessKeyId: need('S3_ACCESS_KEY_ID'), secretAccessKey: need('S3_SECRET_ACCESS_KEY') },
  });
}

/** Every video under AI_Film as { path (with /), size }. */
function localVideos() {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (VIDEO.test(entry.name)) {
        found.push({ path: path.relative(root, full).split(path.sep).join('/'), size: statSync(full).size });
      }
    }
  };
  walk(root);
  return found.sort((a, b) => a.path.localeCompare(b.path, 'vi'));
}

const manifestPath = path.join(root, 'MANIFEST.json');
const readManifest = () => (existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).files : []);

function writeManifest(files) {
  writeFileSync(manifestPath, `${JSON.stringify({ files }, null, 2)}\n`);
  const lines = [
    '# AI_Film - danh sách phim',
    '',
    'Video không nằm trong git mà nằm trên R2. Có phim mới thì chạy `npm run film:push` rồi commit `MANIFEST.json` + file này;',
    'đồng nghiệp pull git xong chạy `npm run film:pull` để tải các phim còn thiếu về `AI_Film/`.',
    '',
    `Tổng: ${files.length} video.`,
    '',
    '| File | MB |',
    '| :--- | ---: |',
    ...files.map((file) => `| ${file.path} | ${Math.round(file.size / MB)} |`),
    '',
  ];
  writeFileSync(path.join(root, 'MANIFEST.md'), lines.join('\n'));
}

async function remoteSize(s3, key) {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: need('S3_BUCKET'), Key: key }));
    return head.ContentLength;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return null;
    throw error;
  }
}

async function push() {
  const s3 = client();
  const files = localVideos();
  let uploaded = 0;
  for (const file of files) {
    if ((await remoteSize(s3, PREFIX + file.path)) === file.size) continue;
    console.log(`upload  ${file.path} (${Math.round(file.size / MB)} MB)`);
    await s3.send(
      new PutObjectCommand({
        Bucket: need('S3_BUCKET'),
        Key: PREFIX + file.path,
        Body: createReadStream(path.join(root, file.path)),
        ContentLength: file.size,
        ContentType: 'video/mp4',
      }),
    );
    uploaded += 1;
  }
  writeManifest(files);
  console.log(`${uploaded} uploaded, ${files.length - uploaded} already on R2. Commit AI_Film/MANIFEST.json and MANIFEST.md.`);
}

const missingLocally = () =>
  readManifest().filter((file) => {
    const full = path.join(root, file.path);
    return !existsSync(full) || statSync(full).size !== file.size;
  });

async function pull() {
  const s3 = client();
  const todo = missingLocally();
  for (const file of todo) {
    const target = path.join(root, file.path);
    console.log(`download ${file.path} (${Math.round(file.size / MB)} MB)`);
    await mkdir(path.dirname(target), { recursive: true });
    const response = await s3.send(new GetObjectCommand({ Bucket: need('S3_BUCKET'), Key: PREFIX + file.path }));
    // Written beside the target and renamed, so an interrupted download never looks like a finished film.
    await pipeline(response.Body, createWriteStream(`${target}.part`));
    await rename(`${target}.part`, target);
  }
  console.log(todo.length ? `${todo.length} downloaded.` : 'Nothing to download: every film in MANIFEST.json is here.');
}

function list() {
  const todo = missingLocally();
  todo.forEach((file) => console.log(`missing  ${file.path} (${Math.round(file.size / MB)} MB)`));
  console.log(todo.length ? `${todo.length} film(s) to pull.` : 'Up to date.');
}

const commands = { push, pull, list };
const command = commands[process.argv[2]];
if (!command) {
  console.error('Usage: node --env-file=.env AI_Film/film-sync.mjs <push|pull|list>');
  process.exit(1);
}
await command();
