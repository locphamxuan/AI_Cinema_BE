import { Router } from "express";
import { UserController } from "./controller";

const router = Router();

const userController = new UserController();
const userRouter = Router();
// TODO: khai báo route cho User (vd. userRouter.get("/", ...)).
void userController;
router.use("/users", userRouter);

export default router;
