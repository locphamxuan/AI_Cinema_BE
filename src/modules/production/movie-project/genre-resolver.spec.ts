import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { resolveGenreIds } from './genre-resolver';

describe('resolveGenreIds', () => {
  const genre = { count: jest.fn(), findFirst: jest.fn(), create: jest.fn() };
  const db = { genre } as unknown as PrismaService;

  beforeEach(() => jest.clearAllMocks());

  it('adds a genre the table does not have yet and reuses one it has, ignoring case', async () => {
    genre.findFirst.mockImplementation(({ where }: { where: { name: { equals: string } } }) =>
      Promise.resolve(where.name.equals === 'Hành động' ? { id: 'action' } : null),
    );
    genre.create.mockResolvedValue({ id: 'new' });

    const ids = await resolveGenreIds(db, [], ['Hành động', ' Hậu tận thế ', 'hậu tận thế']);

    expect(ids).toEqual(['action', 'new']);
    expect(genre.create).toHaveBeenCalledTimes(1);
    expect(genre.create).toHaveBeenCalledWith({ data: { name: 'Hậu tận thế' } });
  });

  it('refuses an unknown id, no genre at all, or more than five', async () => {
    genre.count.mockResolvedValue(0);
    await expect(resolveGenreIds(db, ['missing'])).rejects.toThrow(BadRequestException);
    await expect(resolveGenreIds(db, [], [])).rejects.toThrow('Choose at least one genre');
    genre.findFirst.mockResolvedValue(null);
    genre.create.mockImplementation(({ data }: { data: { name: string } }) => Promise.resolve({ id: data.name }));
    await expect(resolveGenreIds(db, [], ['a', 'b', 'c', 'd', 'e', 'f'])).rejects.toThrow('at most 5');
  });
});
