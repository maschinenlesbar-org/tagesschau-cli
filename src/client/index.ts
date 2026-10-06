// Public entry point for the API client library.

export { TagesschauClient, newsDateProblem } from "./client.js";
export {
  RequestEngine,
  assertHeaderValue,
  DEFAULT_BASE_URL,
  MAX_DETAIL_LENGTH,
  MAX_REDIRECTS,
  MAX_RETRIES,
  MAX_RETRY_AFTER_MS,
  isBidiControl,
  parseRetryAfter,
  sanitizeServerText,
  validateBaseUrl,
} from "./engine.js";
export type { EngineOptions, RawResponse } from "./engine.js";
export { MAX_TIMEOUT_MS, nodeHttpTransport } from "./http.js";
export type { Transport, HttpRequest, HttpResponse } from "./http.js";
export { buildQueryString } from "./query.js";
export {
  assertValid,
  baseUrlProblem,
  baseUrlWhitespaceProblem,
  headerValueProblem,
  MAX_SEARCH_INT,
  pageSizeProblem,
  regionProblem,
  ressortProblem,
  resultPageProblem,
  searchTextProblem,
} from "./validate.js";
export type { Problem } from "./validate.js";
export type { QueryParams, QueryValue } from "./query.js";
export {
  TagesschauError,
  TagesschauApiError,
  TagesschauNetworkError,
  TagesschauParseError,
  TagesschauValidationError,
  redactUrl,
  credentialsIn,
  redactCredentials,
} from "./errors.js";

export * from "./enums.js";
export * from "./types.js";
