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
@Controller('projects/:movieId/fee')
export class ProductionFeeController {
  constructor(private readonly fees: ProductionFeeService) {}

  @Get()
  @ApiOperation({ summary: 'Production fee of the project: total and every ledger entry' })
  ledger(@Param('movieId', ParseUUIDPipe) movieId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.fees.ledger(movieId, user);
  }

  @Post('entries')
  @RequirePermission(PERMISSION.PROJECT_FEE_ALLOCATE)
  @ApiOperation({ summary: 'Allocate (INITIAL), top up or correct the production fee (BR-46)' })
  addEntry(
    @Param('movieId', ParseUUIDPipe) movieId: string,
    @Body() dto: AddFeeEntryRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.fees.addEntry(movieId, dto, user);
  }
}
