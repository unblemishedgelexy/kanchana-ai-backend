import { IS_PRODUCTION } from "../config.js";

export const notFoundHandler = (req, res) =>
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });

export const errorHandler = (error, _req, res, _next) => {
  const statusCode = Number(error?.statusCode || 500);
  const hasExplicitHttpMessage = Boolean(error?.statusCode && error?.message);

  // eslint-disable-next-line no-console
  console.error("[backend:error]", error);

  const response = {
    message: hasExplicitHttpMessage ? error.message : "Something went wrong on server.",
  };

  if (error?.code) {
    response.code = error.code;
  }

  if (error?.details) {
    response.details = error.details;
  }

  if (!IS_PRODUCTION && error?.stack) {
    response.stack = error.stack;
  }

  return res.status(statusCode).json(response);
};
