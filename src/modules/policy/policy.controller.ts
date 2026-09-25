import { Controller, Get } from '@nestjs/common';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, Paginate, type PaginateQuery } from '@nestarc/pagination';
import { PolicyDto } from './dto/policy.dto';
import { PolicyService } from './policy.service';

@ApiTags('policies')
@ApiBearerAuth()
@RequirePermission(PERMISSION.PRODUCTION_READ)
@Controller('policies')
export class PolicyController {
  constructor(private readonly policyService: PolicyService) {}

  @Get()
  @ApiPaginatedResponse(PolicyDto)
  async findAll(@Paginate() query: PaginateQuery) {
    return this.policyService.findAll(query);
  }
}
