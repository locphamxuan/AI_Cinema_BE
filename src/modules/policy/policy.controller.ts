import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, Paginate, type PaginateQuery } from '@nestarc/pagination';
import { PolicyDto } from './dto/policy.dto';
import { PolicyService } from './policy.service';
import { Roles } from 'src/common/decorators/roles.decorator';
import { MF1_ROLES } from 'src/common/auth/mf1-roles';

@ApiTags('policies')
@ApiBearerAuth()
@Roles(...MF1_ROLES)
@Controller('policies')
export class PolicyController {
  constructor(private readonly policyService: PolicyService) {}

  @Get()
  @ApiPaginatedResponse(PolicyDto)
  async findAll(@Paginate() query: PaginateQuery) {
    return this.policyService.findAll(query);
  }
}
