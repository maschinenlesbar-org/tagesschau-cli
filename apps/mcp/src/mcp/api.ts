// How the MCP server reaches this repository's client. The server's generic files (server.ts,
// limiter.ts, config.ts, run.ts, result.ts: the kit, the same in every repository) import the
// client only through this file, under the names below; the names on the right are this
// client's. Per repository, like tools.ts: a client whose names or functions differ adapts here.

import { DEFAULT_BASE_URL, nodeHttpTransport as plainTransport, type Transport } from "@maschinenlesbar.org/tagesschau-client";
import { hourlyBudget } from "@maschinenlesbar.org/tagesschau-client/internal/budget";

export {
  TagesschauClient as Client,
  TagesschauError as ClientError,
  TagesschauNetworkError as NetworkError,
  baseUrlProblem,
  DEFAULT_BASE_URL,
  MAX_TIMEOUT_MS,
  type HttpRequest,
  type HttpResponse,
  type Transport,
} from "@maschinenlesbar.org/tagesschau-client";
/**
 * The server's transport keeps to the API's budget of 60 requests an hour (the client's
 * `hourlyBudget`): one server process runs for hours and serves many calls, so the budget is
 * the process's, across every call and client. The kit's limiter (run.ts) wraps this one.
 */
export function serverTransport(base: Transport): Transport {
  return hourlyBudget(base);
}

/** The default transport the kit's run.ts uses: node:http(s), under the hourly budget. */
export const nodeHttpTransport: Transport = serverTransport(plainTransport);

export { sizeLimitMessage } from "@maschinenlesbar.org/tagesschau-client/internal/http";
export { cutText, toWellFormed } from "@maschinenlesbar.org/tagesschau-client/internal/errors";

/**
 * The API's base as a result's `source` starts with it: the host (`--base-url`, else the default)
 * and the API's path /api2u, which every request of the client goes to.
 */
export function apiBase(baseUrl: string | undefined): string {
  return `${(baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}/api2u`;
}
