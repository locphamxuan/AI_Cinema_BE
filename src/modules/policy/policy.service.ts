import { Injectable } from '@nestjs/common';
import { paginate, PaginateQuery } from '@nestarc/pagination';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class PolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: PaginateQuery) {
    return paginate(query, this.prisma.policy, {
      sortableColumns: [
        'id',
        'name',
        'type',
        'version',
        'documentReference',
        'effectiveFrom',
        'effectiveTo',
        'isActive',
        'createdAt',
      ],
      defaultSortBy: [['name', 'ASC']],
      searchableColumns: ['name', 'documentReference'],
      filterableColumns: {
        type: ['$eq', '$in'],
        isActive: ['$eq'],
      },
    });
  }
}
