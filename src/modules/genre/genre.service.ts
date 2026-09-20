import { Injectable } from '@nestjs/common';
import { paginate, PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/prisma/prisma.service';

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
}
