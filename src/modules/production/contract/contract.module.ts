import { Module } from '@nestjs/common';
import { ProductionCostModule } from 'src/modules/production/production-cost/production-cost.module';
import { StudioModule } from 'src/modules/production/studio/studio.module';
import { ContractHandoffService } from './contract-handoff.service';
import { ContractController } from './contract.controller';
import { ContractService } from './contract.service';

@Module({
  imports: [ProductionCostModule, StudioModule],
  controllers: [ContractController],
  providers: [ContractService, ContractHandoffService],
  exports: [ContractService],
})
export class ContractModule {}
