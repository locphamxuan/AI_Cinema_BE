import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ContractService } from './contract.service';
import { ContractCostRequestDto, CreateContractRequestDto } from './dto/contract.request.dto';

const ID = new ParseUUIDPipe({ version: '4' });

/** MF-1 contract negotiation between the Admin and the project's studio (Admin side; the studio uses /studio-portal). */
@ApiTags('contracts')
@ApiBearerAuth()
@Controller()
export class ContractController {
  constructor(private readonly contracts: ContractService) {}

  @Post('projects/:projectId/contracts')
  @RequirePermission(PERMISSION.CONTRACT_MANAGE)
  @ApiOperation({
    summary: "Admin: send the project's studio its template contract again (normally sent on Final Script)",
  })
  create(
    @Param('projectId', ID) projectId: string,
    @Body() dto: CreateContractRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.contracts.resend(projectId, dto.terms, user);
  }

  @Get('projects/:projectId/contracts')
  @ApiOperation({ summary: 'Every negotiation round of the project with its studio' })
  list(@Param('projectId', ID) projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.contracts.list(projectId, user);
  }

  @Post('contracts/:contractId/sign')
  @HttpCode(200)
  @RequirePermission(PERMISSION.CONTRACT_MANAGE)
  @ApiOperation({ summary: "Admin: agree with the studio's cost and sign, completing the contract" })
  sign(@Param('contractId', ID) contractId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.contracts.sign(contractId, user);
  }

  @Post('contracts/:contractId/counter')
  @HttpCode(200)
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
