import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { AddFeeEntryRequestDto } from './dto/add-fee-entry.request.dto';
import { ProductionFeeService } from './production-fee.service';

@ApiTags('production-fee')
@ApiBearerAuth()
@Controller('projects/:projectId/fee')
export class ProductionFeeController {
  constructor(private readonly fees: ProductionFeeService) {}

  @Get()
  @ApiOperation({ summary: 'Production fee of the project: total and every ledger entry' })
  ledger(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.fees.ledger(projectId, user);
  }

  @Post('entries')
  @RequirePermission(PERMISSION.PROJECT_FEE_ALLOCATE)
  @ApiOperation({ summary: 'Allocate (INITIAL), top up or correct the production fee (BR-46)' })
  addEntry(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: AddFeeEntryRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fees.addEntry(projectId, dto, user);
  }
}
