import { ComplianceCheckRepository, AiContentLabelRepository } from "./repository";

// TODO: triển khai business logic cho ComplianceCheck.
export class ComplianceCheckService {
  constructor(private readonly repository: ComplianceCheckRepository = new ComplianceCheckRepository()) {}
}

// TODO: triển khai business logic cho AiContentLabel.
export class AiContentLabelService {
  constructor(private readonly repository: AiContentLabelRepository = new AiContentLabelRepository()) {}
}
