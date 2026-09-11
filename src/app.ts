import express from "express";
import authRoutes from "./modules/auth";
import catalogRoutes from "./modules/catalog";
import productionRoutes from "./modules/production";
import aiPipelineRoutes from "./modules/ai-pipeline";
import complianceRoutes from "./modules/compliance";
import { errorHandler } from "./common/middlewares/errorHandler";
import { requestId } from "./common/middlewares/requestId";

const app = express();

app.use(express.json());
app.use(requestId);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/catalog", catalogRoutes);
app.use("/api/v1/production", productionRoutes);
app.use("/api/v1/ai-pipeline", aiPipelineRoutes);
app.use("/api/v1/compliance", complianceRoutes);

app.use(errorHandler);

export default app;
