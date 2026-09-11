import { AiProviderService, AiModelService, GenerationJobService, GeneratedAssetService } from "./service";

// TODO: triển khai handler cho từng endpoint của AiProvider.
export class AiProviderController {
  constructor(private readonly service: AiProviderService = new AiProviderService()) {}
}

// TODO: triển khai handler cho từng endpoint của AiModel.
export class AiModelController {
  constructor(private readonly service: AiModelService = new AiModelService()) {}
}

// TODO: triển khai handler cho từng endpoint của GenerationJob.
export class GenerationJobController {
  constructor(private readonly service: GenerationJobService = new GenerationJobService()) {}
}

// TODO: triển khai handler cho từng endpoint của GeneratedAsset.
export class GeneratedAssetController {
  constructor(private readonly service: GeneratedAssetService = new GeneratedAssetService()) {}
}
