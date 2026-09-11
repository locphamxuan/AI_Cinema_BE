import { ErrorRequestHandler } from "express";
import { AppError } from "../errors/AppError";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { code: err.code ?? "APP_ERROR", message: err.message } });
    return;
  }
  // TODO: log lỗi qua Pino, ẩn chi tiết khi NODE_ENV=production
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
};
