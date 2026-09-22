import { Injectable } from '@nestjs/common';
import { paginate, PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: PaginateQuery) {
    return paginate(query, this.prisma.user, {
      sortableColumns: ['id', 'email', 'fullName', 'role', 'isActive', 'createdAt', 'updatedAt'],
      defaultSortBy: [['fullName', 'ASC']],
      searchableColumns: ['email', 'fullName'],
      filterableColumns: {
        role: ['$eq', '$in'],
        isActive: ['$eq'],
      },
    });
  }
}
