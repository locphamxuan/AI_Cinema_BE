import { ComplianceCheckService, AiContentLabelService } from "./service";

// TODO: triển khai handler cho từng endpoint của ComplianceCheck.
export class ComplianceCheckController {
  constructor(private readonly service: ComplianceCheckService = new ComplianceCheckService()) {}
}

// TODO: triển khai handler cho từng endpoint của AiContentLabel.
export class AiContentLabelController {
  constructor(private readonly service: AiContentLabelService = new AiContentLabelService()) {}
}
