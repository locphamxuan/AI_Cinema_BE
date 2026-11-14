import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { AddCostEntryRequestDto } from './dto/add-cost-entry.request.dto';
import { ProductionCostService } from './production-cost.service';

@ApiTags('production-cost')
@ApiBearerAuth()
@Controller('projects/:projectId/costs')
export class ProductionCostController {
  constructor(private readonly costs: ProductionCostService) {}

  @Get()
  @ApiOperation({ summary: 'Production cost (VND): budget, committed to studios, left, and every ledger entry' })
  ledger(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.costs.ledger(projectId, user);
  }

  @Post('entries')
  @RequirePermission(PERMISSION.COST_ADJUST)
  @ApiOperation({ summary: 'Admin: set the budget of the project (BUDGET, once) or correct it (BR-46)' })
  addEntry(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: AddCostEntryRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.costs.addEntry(projectId, dto, user);
  }
}
