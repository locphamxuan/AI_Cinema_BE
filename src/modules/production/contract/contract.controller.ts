import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ContractService } from './contract.service';
import { ContractCostRequestDto, CreateContractRequestDto } from './dto/contract.request.dto';

const ID = new ParseUUIDPipe({ version: '4' });

/** MF-1 contract negotiation between Admin and a studio, on top of a hand-off's production cost. */
@ApiTags('contracts')
@ApiBearerAuth()
@Controller()
export class ContractController {
  constructor(private readonly contracts: ContractService) {}

  @Post('projects/:projectId/handoffs/:handoffId/contracts')
  @RequirePermission(PERMISSION.CONTRACT_MANAGE)
  @ApiOperation({ summary: 'Admin: send the studio a template contract for this hand-off (no cost yet)' })
  create(
    @Param('projectId', ID) projectId: string,
    @Param('handoffId', ID) handoffId: string,
    @Body() dto: CreateContractRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.contracts.create(projectId, handoffId, dto.terms, user);
  }

  @Get('projects/:projectId/contracts')
  @ApiOperation({ summary: 'Every negotiation round of every hand-off of the project' })
  list(@Param('projectId', ID) projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.contracts.list(projectId, user);
  }

  @Post('contracts/:contractId/sign')
  @RequirePermission(PERMISSION.CONTRACT_MANAGE)
  @ApiOperation({ summary: "Admin: agree with the studio's cost and sign, completing the contract" })
  sign(@Param('contractId', ID) contractId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.contracts.sign(contractId, user);
  }

  @Post('contracts/:contractId/counter')
  @RequirePermission(PERMISSION.CONTRACT_MANAGE)
  @ApiOperation({ summary: 'Admin: propose a different cost instead, signed, opening a new round for the studio' })
  counter(
    @Param('contractId', ID) contractId: string,
    @Body() dto: ContractCostRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.contracts.counter(contractId, dto.costVnd, user);
  }
}
