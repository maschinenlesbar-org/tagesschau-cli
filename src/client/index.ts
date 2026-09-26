// Public entry point for the API client library.

export { TagesschauClient } from "./client.js";
export {
  RequestEngine,
  DEFAULT_BASE_URL,
  MAX_REDIRECTS,
  MAX_RETRIES,
  MAX_RETRY_AFTER_MS,
  parseRetryAfter,
} from "./engine.js";
export type { EngineOptions, RawResponse } from "./engine.js";
export { MAX_TIMEOUT_MS, nodeHttpTransport } from "./http.js";
export type { Transport, HttpRequest, HttpResponse } from "./http.js";
export { buildQueryString } from "./query.js";
export type { QueryParams, QueryValue } from "./query.js";
export {
  TagesschauError,
  TagesschauApiError,
  TagesschauNetworkError,
  TagesschauParseError,
} from "./errors.js";

export * from "./enums.js";
export * from "./types.js";
