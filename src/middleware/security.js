import helmet from "helmet";

export const securityHeadersMiddleware = helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
});
