import { RequestHandler } from "express";

// TODO: gắn request id (uuid) vào mỗi request để trace log xuyên suốt.
export const requestId: RequestHandler = (_req, _res, next) => {
  next();
};
