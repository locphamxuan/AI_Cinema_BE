import { Router } from "express";
import { MovieController, SeasonController, EpisodeController, GenreController } from "./controller";

const router = Router();

const movieController = new MovieController();
const movieRouter = Router();
// TODO: khai báo route cho Movie (vd. movieRouter.get("/", ...)).
void movieController;
router.use("/movies", movieRouter);

const seasonController = new SeasonController();
const seasonRouter = Router();
// TODO: khai báo route cho Season (vd. seasonRouter.get("/", ...)).
void seasonController;
router.use("/seasons", seasonRouter);

const episodeController = new EpisodeController();
const episodeRouter = Router();
// TODO: khai báo route cho Episode (vd. episodeRouter.get("/", ...)).
void episodeController;
router.use("/episodes", episodeRouter);

const genreController = new GenreController();
const genreRouter = Router();
// TODO: khai báo route cho Genre (vd. genreRouter.get("/", ...)).
void genreController;
router.use("/genres", genreRouter);

export default router;
