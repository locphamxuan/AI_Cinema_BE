import { Router } from "express";
import { AiProviderController, AiModelController, GenerationJobController, GeneratedAssetController } from "./controller";

const router = Router();

const aiProviderController = new AiProviderController();
const aiProviderRouter = Router();
// TODO: khai báo route cho AiProvider (vd. aiProviderRouter.get("/", ...)).
void aiProviderController;
router.use("/ai-providers", aiProviderRouter);

const aiModelController = new AiModelController();
const aiModelRouter = Router();
// TODO: khai báo route cho AiModel (vd. aiModelRouter.get("/", ...)).
void aiModelController;
router.use("/ai-models", aiModelRouter);

const generationJobController = new GenerationJobController();
const generationJobRouter = Router();
// TODO: khai báo route cho GenerationJob (vd. generationJobRouter.get("/", ...)).
void generationJobController;
router.use("/generation-jobs", generationJobRouter);

const generatedAssetController = new GeneratedAssetController();
const generatedAssetRouter = Router();
// TODO: khai báo route cho GeneratedAsset (vd. generatedAssetRouter.get("/", ...)).
void generatedAssetController;
router.use("/generated-assets", generatedAssetRouter);

export default router;
