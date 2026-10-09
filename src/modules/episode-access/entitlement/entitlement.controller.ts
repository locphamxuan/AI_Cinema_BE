import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AccessSource } from '@prisma/client';
import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { EntitlementService } from './entitlement.service';
import { AccessesQueryDto } from 'src/modules/episode-access/entitlement/dto/accesses.query.dto';

@ApiTags('episode-access')
@ApiBearerAuth()
@Controller('accesses')
export class EntitlementController {
  constructor(private readonly entitlements: EntitlementService) {}

  @Get()
  @RequirePermission(PERMISSION.ACCESS_EPISODE_READ)
  @ApiOperation({
    summary: 'Episodes the caller has bought and series bought as a bundle',
  })
  @ApiQuery({
    name: 'source',
    required: false,
    enum: AccessSource,
  })
  list(@CurrentUser('id') userId: string, @Paginate() query: PaginateQuery, @Query() filter: AccessesQueryDto) {
    return this.entitlements.listFor({ userId, source: filter.source }, query);
  }
}
