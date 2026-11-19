// The Tagesschau API's documented budget: at most 60 requests an hour per client
// (https://tagesschau.api.bund.dev). A long-running process — the MCP server — keeps to it:
// `hourlyBudget` wraps a transport and refuses the request that would be one too many in the
// last hour, before it is sent, naming when the next one is possible. Retries and redirects go
// through the transport too, so each counts. Refused, not delayed: a wait of up to an hour would
// outlast any caller's deadline, and the caller can decide what to ask instead.

import { TagesschauNetworkError } from "./errors.js";
import type { Transport } from "./http.js";

/** Requests the API allows per client in any hour. */
export const REQUESTS_PER_HOUR = 60;

const HOUR_MS = 3_600_000;

export interface HourlyBudgetOptions {
  /** Requests allowed in any hour (default REQUESTS_PER_HOUR). */
  max?: number;
  /** The clock (ms); tests inject one. */
  now?: () => number;
}

/** `transport`, refusing any request beyond `max` in a sliding hour. */
export function hourlyBudget(transport: Transport, options: HourlyBudgetOptions = {}): Transport {
  const max = options.max ?? REQUESTS_PER_HOUR;
  if (!Number.isSafeInteger(max) || max < 1) throw new RangeError(`max must be a positive integer, got ${String(max)}.`);
  const now = options.now ?? Date.now;
  const starts: number[] = [];
  return (request) => {
    const t = now();
    while (starts.length > 0 && (starts[0] as number) <= t - HOUR_MS) starts.shift();
    if (starts.length >= max) {
      const next = (starts[0] as number) + HOUR_MS;
      const minutes = Math.max(1, Math.ceil((next - t) / 60_000));
      return Promise.reject(
        new TagesschauNetworkError(
          `${request.method} ${request.url} not sent: the Tagesschau API allows ${max} requests an hour, and ` +
            `${max} were made in the last hour. The next request is possible at ` +
            `${new Date(next).toISOString().slice(11, 16)} UTC (in ${minutes} min).`,
        ),
      );
    }
    starts.push(t);
    return transport(request);
  };
}
