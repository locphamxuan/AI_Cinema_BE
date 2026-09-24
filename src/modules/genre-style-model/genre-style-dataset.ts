import * as path from 'node:path';

/**
 * Each GenreStyleModel version owns one dataset folder (PROJECT_OVERVIEW.md
 * §4.1.8.1 — "mỗi Genre style = 1 thư mục dữ liệu riêng"):
 *
 *   genre-styles/<genre-slug>/<triggerKeyword>/v<version>/
 *     001.png + 001.txt   (image + caption with the same basename)
 *
 * Sample storageKeys are relative to the training-data root, so the same key
 * works for the local folder in dev (TRAINING_DATA_ROOT) and for an object
 * storage bucket later.
 */
export const GENRE_STYLE_DATASET_PREFIX = 'genre-styles';
export const TRAINING_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function genreStyleDatasetFolder(genreName: string, triggerKeyword: string, version: number): string {
  return `${GENRE_STYLE_DATASET_PREFIX}/${slugify(genreName)}/${triggerKeyword}/v${version}`;
}

export function isTrainingImage(fileName: string): boolean {
  return TRAINING_IMAGE_EXTENSIONS.includes(path.extname(fileName).toLowerCase());
}

export function trainingDataRoot(): string {
  return path.resolve(process.env.TRAINING_DATA_ROOT ?? 'training-data');
}
