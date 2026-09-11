import { AiProviderRepository, AiModelRepository, GenerationJobRepository, GeneratedAssetRepository } from "./repository";

// TODO: triển khai business logic cho AiProvider.
export class AiProviderService {
  constructor(private readonly repository: AiProviderRepository = new AiProviderRepository()) {}
}

// TODO: triển khai business logic cho AiModel.
export class AiModelService {
  constructor(private readonly repository: AiModelRepository = new AiModelRepository()) {}
}

// TODO: triển khai business logic cho GenerationJob.
export class GenerationJobService {
  constructor(private readonly repository: GenerationJobRepository = new GenerationJobRepository()) {}
}

// TODO: triển khai business logic cho GeneratedAsset.
export class GeneratedAssetService {
  constructor(private readonly repository: GeneratedAssetRepository = new GeneratedAssetRepository()) {}
}
