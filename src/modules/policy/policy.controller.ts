import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, Paginate, type PaginateQuery } from '@nestarc/pagination';
import { PolicyDto } from './dto/policy.dto';
import { PolicyService } from './policy.service';

@ApiTags('policies')
@Controller('policies')
export class PolicyController {
  constructor(private readonly policyService: PolicyService) {}

  @Get()
  @ApiPaginatedResponse(PolicyDto)
  async findAll(@Paginate() query: PaginateQuery) {
    return this.policyService.findAll(query);
  }
}
