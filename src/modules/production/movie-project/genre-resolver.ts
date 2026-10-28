import { BadRequestException } from '@nestjs/common';
import { PrismaService, type PrismaTx } from 'src/infrastructure/prisma/prisma.service';

const MAX_GENRES_PER_MOVIE = 5;

/**
 * The genre ids of a project from the ids and the names the Reviewer sent. A name the genres table does not
 * have yet is added on the spot (matched ignoring case), so a new project never fails on a missing genre.
 */
export async function resolveGenreIds(
  db: PrismaService | PrismaTx,
  genreIds: string[] = [],
  genreNames: string[] = [],
): Promise<string[]> {
  if (genreIds.length) {
    const found = await db.genre.count({ where: { id: { in: genreIds } } });
    if (found !== new Set(genreIds).size) throw new BadRequestException('One of the genres does not exist');
  }
  // The first spelling of a name wins; the same name in another case is the same genre.
  const names = new Map<string, string>();
  for (const name of genreNames.map((n) => n.trim()).filter(Boolean)) {
    if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  }
  const ids = new Set(genreIds);
  for (const name of names.values()) {
    const existing = await db.genre.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    const genre = existing ?? (await db.genre.create({ data: { name } }));
    ids.add(genre.id);
  }
  if (ids.size === 0) throw new BadRequestException('Choose at least one genre');
  if (ids.size > MAX_GENRES_PER_MOVIE)
    throw new BadRequestException(`A movie has at most ${MAX_GENRES_PER_MOVIE} genres`);
  return [...ids];
}
