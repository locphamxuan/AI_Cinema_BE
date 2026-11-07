import { Module } from '@nestjs/common';
import { ContractInboundController } from './contract-inbound.controller';
import { ContractController } from './contract.controller';
import { ContractService } from './contract.service';

@Module({
  controllers: [ContractController, ContractInboundController],
  providers: [ContractService],
  exports: [ContractService],
})
export class ContractModule {}
