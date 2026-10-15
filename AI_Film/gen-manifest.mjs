// Lists every film under AI_Film into MANIFEST.md. The videos themselves are not in git (GitHub refuses files
// over 100 MB), so this file is how teammates see that a film was added: it changes whenever a film does.
// Run after adding a film:  node AI_Film/gen-manifest.mjs
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const VIDEO = /\.(mp4|mov|mkv)$/i;
const rows = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'vi'))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (VIDEO.test(entry.name)) {
      const size = statSync(full).size;
      rows.push({ file: path.relative(root, full).split(path.sep).join('/'), mb: Math.round(size / 1024 / 1024) });
    }
  }
}
walk(root);

const lines = [
  '# AI_Film — danh sách phim',
  '',
  'File video **không** nằm trong git (quá lớn). Mỗi lần thêm phim, chạy `node AI_Film/gen-manifest.mjs` rồi commit file này;',
  'ai pull về thấy dòng mới ở đây là biết có phim mới và lấy file video từ người thêm.',
  '',
  `Tổng: ${rows.length} video.`,
  '',
  '| File | MB |',
  '| :--- | ---: |',
  ...rows.map((row) => `| ${row.file} | ${row.mb} |`),
  '',
];
writeFileSync(path.join(root, 'MANIFEST.md'), lines.join('\n'));
console.log(`MANIFEST.md: ${rows.length} video`);
