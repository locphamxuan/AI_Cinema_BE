import { Module } from '@nestjs/common';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { ProductionCostModule } from 'src/modules/production/production-cost/production-cost.module';
import { StudioModule } from 'src/modules/production/studio/studio.module';
import { ContractCompletionService } from './contract-completion.service';
import { ContractDocumentService } from './contract-document.service';
import { ContractHandoffService } from './contract-handoff.service';
import { ContractSignatureService } from './contract-signature.service';
import { StudioContractService } from './contract-studio.service';
import { ContractController } from './contract.controller';
import { ContractService } from './contract.service';
import { ContractTemplateService } from './template/contract-template.service';

@Module({
  imports: [ProductionCostModule, StudioModule, PlatformSettingModule],
  controllers: [ContractController],
  providers: [
    ContractService,
    StudioContractService,
    ContractHandoffService,
    ContractSignatureService,
    ContractCompletionService,
    ContractDocumentService,
    ContractTemplateService,
  ],
  exports: [ContractService, StudioContractService, ContractDocumentService, ContractTemplateService],
})
export class ContractModule {}
