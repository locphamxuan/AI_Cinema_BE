import { Module } from '@nestjs/common';
import { ProductionCostModule } from 'src/modules/production/production-cost/production-cost.module';
import { StudioModule } from 'src/modules/production/studio/studio.module';
import { ContractCompletionService } from './contract-completion.service';
import { ContractDocumentService } from './contract-document.service';
import { ContractHandoffService } from './contract-handoff.service';
import { ContractSignatureService } from './contract-signature.service';
import { StudioContractService } from './contract-studio.service';
import { ContractController } from './contract.controller';
import { ContractService } from './contract.service';

@Module({
  imports: [ProductionCostModule, StudioModule],
  controllers: [ContractController],
  providers: [
    ContractService,
    StudioContractService,
    ContractHandoffService,
    ContractSignatureService,
    ContractCompletionService,
    ContractDocumentService,
  ],
  exports: [ContractService, StudioContractService, ContractDocumentService],
})
export class ContractModule {}
