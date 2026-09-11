import { Router } from "express";
import { ComplianceCheckController, AiContentLabelController } from "./controller";

const router = Router();

const complianceCheckController = new ComplianceCheckController();
const complianceCheckRouter = Router();
// TODO: khai báo route cho ComplianceCheck (vd. complianceCheckRouter.get("/", ...)).
void complianceCheckController;
router.use("/compliance-checks", complianceCheckRouter);

const aiContentLabelController = new AiContentLabelController();
const aiContentLabelRouter = Router();
// TODO: khai báo route cho AiContentLabel (vd. aiContentLabelRouter.get("/", ...)).
void aiContentLabelController;
router.use("/ai-content-labels", aiContentLabelRouter);

export default router;
