import { Module } from '@nestjs/common';
import { ProductionCostModule } from 'src/modules/production/production-cost/production-cost.module';
import { ContractHandoffService } from './contract-handoff.service';
import { ContractController } from './contract.controller';
import { ContractService } from './contract.service';

@Module({
  imports: [ProductionCostModule],
  controllers: [ContractController],
  providers: [ContractService, ContractHandoffService],
  exports: [ContractService],
})
export class ContractModule {}
