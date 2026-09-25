import { Injectable } from '@nestjs/common';
import { paginate, PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateGenreRequestDto } from './dto/create-genre.request.dto';

@Injectable()
export class GenreService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: PaginateQuery) {
    return paginate(query, this.prisma.genre, {
      sortableColumns: ['id', 'name', 'description'],
      defaultSortBy: [['name', 'ASC']],
      searchableColumns: ['name', 'description'],
      filterableColumns: {
        name: ['$eq', '$in'],
      },
    });
  }

  /** Creates the genre, or returns the existing one with the same name (ignoring case). */
  async create(dto: CreateGenreRequestDto) {
    const existing = await this.prisma.genre.findFirst({
      where: { name: { equals: dto.name, mode: 'insensitive' } },
    });
    if (existing) return existing;
    return this.prisma.genre.create({ data: { name: dto.name, description: dto.description } });
  }
}
