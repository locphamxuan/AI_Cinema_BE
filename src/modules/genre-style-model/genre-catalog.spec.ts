import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { GENRE_CATALOG, genreStyleTriggerKeyword } from '../../../prisma/genre-catalog';
import { genreStyleDatasetFolder } from './genre-style-dataset';

describe('GENRE_CATALOG', () => {
  it('has unique genre names and style keys', () => {
    expect(new Set(GENRE_CATALOG.map((g) => g.name)).size).toBe(GENRE_CATALOG.length);
    expect(new Set(GENRE_CATALOG.map((g) => g.styleKey)).size).toBe(GENRE_CATALOG.length);
  });

  it('produces trigger keywords accepted by CreateGenreStyleModelRequestDto', () => {
    for (const { styleKey } of GENRE_CATALOG) {
      expect(genreStyleTriggerKeyword(styleKey)).toMatch(/^[a-z0-9-]{1,100}$/);
    }
  });

  it('has a v1 dataset folder in training-data for every genre', () => {
    const root = path.resolve(__dirname, '../../../training-data');
    for (const { name, styleKey } of GENRE_CATALOG) {
      const folder = genreStyleDatasetFolder(name, genreStyleTriggerKeyword(styleKey), 1);
      expect(existsSync(path.join(root, folder))).toBe(true);
    }
  });
});
