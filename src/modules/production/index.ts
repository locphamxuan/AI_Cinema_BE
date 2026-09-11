import { Router } from "express";
import { ContentBriefController, EpisodePackageController, ReviewController, PublicationController } from "./controller";

const router = Router();

const contentBriefController = new ContentBriefController();
const contentBriefRouter = Router();
// TODO: khai báo route cho ContentBrief (vd. contentBriefRouter.get("/", ...)).
void contentBriefController;
router.use("/content-briefs", contentBriefRouter);

const episodePackageController = new EpisodePackageController();
const episodePackageRouter = Router();
// TODO: khai báo route cho EpisodePackage (vd. episodePackageRouter.get("/", ...)).
void episodePackageController;
router.use("/episode-packages", episodePackageRouter);

const reviewController = new ReviewController();
const reviewRouter = Router();
// TODO: khai báo route cho Review (vd. reviewRouter.get("/", ...)).
void reviewController;
router.use("/reviews", reviewRouter);

const publicationController = new PublicationController();
const publicationRouter = Router();
// TODO: khai báo route cho Publication (vd. publicationRouter.get("/", ...)).
void publicationController;
router.use("/publications", publicationRouter);

export default router;
