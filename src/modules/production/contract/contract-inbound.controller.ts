import { timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/common/decorators/public.decorator';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { ContractService } from './contract.service';
import { ContractCostRequestDto } from './dto/contract.request.dto';

const ID = new ParseUUIDPipe({ version: '4' });

/** Called by the Studio Web (a separate site), so it carries a shared token instead of a user session. */
@ApiTags('contracts')
@Controller('studio-inbound/contracts')
export class ContractInboundController {
  constructor(
    private readonly contracts: ContractService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post(':contractId/propose')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'x-studio-token', description: 'STUDIO_WEBHOOK_TOKEN shared with the Studio Web' })
  @ApiOperation({ summary: 'Studio: fill in the cost of a freshly sent template and sign it' })
  propose(
    @Headers('x-studio-token') token: string | undefined,
    @Param('contractId', ID) contractId: string,
    @Body() dto: ContractCostRequestDto,
  ) {
    this.assertToken(token);
    return this.contracts.propose(contractId, dto.costVnd);
  }

  @Post(':contractId/sign')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'x-studio-token', description: 'STUDIO_WEBHOOK_TOKEN shared with the Studio Web' })
  @ApiOperation({ summary: "Studio: agree with Admin's countered cost and sign, completing the contract" })
  sign(@Headers('x-studio-token') token: string | undefined, @Param('contractId', ID) contractId: string) {
    this.assertToken(token);
    return this.contracts.studioSign(contractId);
  }

  @Post(':contractId/counter')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: 'x-studio-token', description: 'STUDIO_WEBHOOK_TOKEN shared with the Studio Web' })
  @ApiOperation({ summary: "Studio: disagree with Admin's countered cost, propose another and sign it" })
  counter(
    @Headers('x-studio-token') token: string | undefined,
    @Param('contractId', ID) contractId: string,
    @Body() dto: ContractCostRequestDto,
  ) {
    this.assertToken(token);
    return this.contracts.studioCounter(contractId, dto.costVnd);
  }

  private assertToken(token: string | undefined) {
    const expected = this.config.studio.webhookToken;
    if (!expected) throw new ServiceUnavailableException('The studio inbound channel is not configured');
    const given = Buffer.from(token ?? '');
    const wanted = Buffer.from(expected);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      throw new UnauthorizedException('Invalid studio token');
    }
  }
}
