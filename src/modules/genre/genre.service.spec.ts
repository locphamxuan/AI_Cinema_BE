import { PrismaService } from 'src/prisma/prisma.service';
import { GenreService } from './genre.service';

describe('GenreService.create', () => {
  const prisma = { genre: { findFirst: jest.fn(), create: jest.fn() } };
  const service = new GenreService(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('adds a genre the list does not have', async () => {
    prisma.genre.findFirst.mockResolvedValue(null);
    prisma.genre.create.mockResolvedValue({ id: 'new', name: 'Hậu tận thế' });

    await expect(service.create({ name: 'Hậu tận thế' })).resolves.toEqual({ id: 'new', name: 'Hậu tận thế' });
    expect(prisma.genre.findFirst).toHaveBeenCalledWith({
      where: { name: { equals: 'Hậu tận thế', mode: 'insensitive' } },
    });
  });

  it('returns the existing genre instead of a duplicate differing only in case', async () => {
    prisma.genre.findFirst.mockResolvedValue({ id: 'kinh-di', name: 'Kinh dị' });

    await expect(service.create({ name: 'KINH DỊ' })).resolves.toEqual({ id: 'kinh-di', name: 'Kinh dị' });
    expect(prisma.genre.create).not.toHaveBeenCalled();
  });
});
