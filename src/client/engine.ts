// The request engine: turns logical (method, path, query) calls into HTTP
// requests via a Transport, applies retry/backoff for transient statuses
// (429, 503), and decodes responses.

import { nodeHttpTransport, type Transport } from "./http.js";
import { buildQueryString, type QueryParams } from "./query.js";
import {
  TagesschauApiError,
  TagesschauError,
  TagesschauNetworkError,
  TagesschauParseError,
} from "./errors.js";

export const DEFAULT_BASE_URL = "https://www.tagesschau.de";
const DEFAULT_USER_AGENT = "tagesschau-cli";

/**
 * Headers that carry credentials. They are stripped before following a redirect
 * to a different origin so they are never leaked to a host the caller did not
 * intend to talk to (open-redirect / SSRF defence). The match is
 * case-insensitive.
 */
const CREDENTIAL_HEADERS = ["authorization", "x-api-key", "cookie"];

export interface RawResponse {
  data: Buffer;
  contentType: string;
  status: number;
}

export interface EngineOptions {
  /** Base URL of the API. Defaults to https://www.tagesschau.de */
  baseUrl?: string;
  /** Swappable transport. Defaults to the built-in node http/https transport. */
  transport?: Transport;
  /** Value of the User-Agent header. */
  userAgent?: string;
  /**
   * Time limit per request in milliseconds, covering the whole response body, not
   * only idle gaps (0 disables; capped at MAX_TIMEOUT_MS, 2^31 - 1 ms). Defaults to 30 s.
   */
  timeoutMs?: number;
  /** Number of automatic retries for transient (429/503) responses. */
  maxRetries?: number;
  /** Base backoff between retries in milliseconds (grows linearly). */
  retryDelayMs?: number;
  /** Number of HTTP redirects (301/302/303/307/308) to follow. Defaults to 5. */
  maxRedirects?: number;
  /**
   * Hard cap on response body size in bytes (defends against memory exhaustion
   * from a hostile/buggy endpoint). Defaults to 100 MiB; set to 0 for no limit.
   */
  maxResponseBytes?: number;
  /** Injectable sleep, primarily for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RESPONSE_BYTES = 100 * 1024 * 1024;

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Strip C0/C1 control characters (except tab and newline) and DEL from a string
 * that originates in an attacker-controlled response — the error `detail`.
 * `JSON.parse` decodes a backslash-u escape in an error body into a real control
 * byte, so without this a hostile/MITM'd endpoint could drive ANSI/OSC escape
 * sequences into the user's terminal when the error message is printed to stderr
 * (title changes, spoofed lines, clipboard writes on some emulators). This only
 * covers text that flows into an error message; the CLI's JSON output is escaped
 * separately (escapeControlChars in cli/shared.ts), since `JSON.stringify` alone
 * leaves DEL and the C1 range raw. Built via char codes so no raw control byte ever
 * appears in this source file.
 */
export function sanitizeServerText(text: string): string {
  let out = "";
  for (const ch of text) {
    const n = ch.codePointAt(0) ?? 0;
    if (n === 9 || n === 10) {
      out += ch;
      continue;
    }
    if (n <= 8 || (n >= 0x0b && n <= 0x1f) || (n >= 0x7f && n <= 0x9f)) continue;
    out += ch;
  }
  return out;
}

/** Return a copy of `headers` with all credential-bearing headers removed. */
export function stripCredentialHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!CREDENTIAL_HEADERS.includes(key.toLowerCase())) out[key] = value;
  }
  return out;
}

/**
 * Reject a base URL whose scheme is not http(s). The default transport already
 * gates this per hop, but the engine is exported as a library and may be handed a
 * custom transport that does no such check, so gate the configured base URL here
 * too (a `file:`/`ftp:` base URL fails fast with a typed error).
 */
function assertHttpScheme(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new TagesschauNetworkError(`Invalid base URL: ${baseUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TagesschauNetworkError(
      `Unsupported protocol "${url.protocol}" in base URL: ${baseUrl}`,
    );
  }
}

export class RequestEngine {
  private readonly baseUrl: string;
  private readonly transport: Transport;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly maxRedirects: number;
  private readonly maxResponseBytes: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: EngineOptions = {}) {
    if (options.baseUrl !== undefined && options.baseUrl.trim() === "") {
      throw new TagesschauError("Base URL must not be empty.");
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    // Re-check the base-URL scheme here, not only in the default transport: a
    // library consumer that injects a custom transport would otherwise get no
    // gating at all, and could be steered to a non-http(s) scheme.
    assertHttpScheme(this.baseUrl);
    this.transport = options.transport ?? nodeHttpTransport;
    // An empty User-Agent would send a blank header (rejected by some hosts);
    // treat it like an unset value and fall back to the default.
    this.userAgent =
      options.userAgent !== undefined && options.userAgent !== ""
        ? options.userAgent
        : DEFAULT_USER_AGENT;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 200;
    this.maxRedirects = options.maxRedirects ?? 5;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.sleep = options.sleep ?? realSleep;
  }

  /** Build a fully-qualified URL from a path and optional query parameters. */
  buildUrl(path: string, query?: QueryParams): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const qs = query ? buildQueryString(query) : "";
    return `${this.baseUrl}${normalizedPath}${qs ? `?${qs}` : ""}`;
  }

  /** Perform a request with Accept negotiation and transient-error retries. */
  async request(
    method: string,
    path: string,
    options: { query?: QueryParams; accept: string } = { accept: "application/json" },
  ): Promise<RawResponse> {
    let url = this.buildUrl(path, options.query);
    let headers: Record<string, string> = {
      Accept: options.accept,
      "User-Agent": this.userAgent,
    };

    let attempt = 0;
    let redirects = 0;
    // attempts = initial try + maxRetries (redirects are counted separately)
    for (;;) {
      const response = await this.transport({
        method,
        url,
        headers,
        timeoutMs: this.timeoutMs,
        ...(this.maxResponseBytes > 0 ? { maxResponseBytes: this.maxResponseBytes } : {}),
      });

      const status = response.status;
      const retryable = status === 429 || status === 503;
      if (retryable && attempt < this.maxRetries) {
        attempt += 1;
        await this.sleep(this.retryDelayMs * attempt);
        continue;
      }

      // Follow redirects, resolving the Location relative to the current URL.
      if (status >= 300 && status < 400) {
        if (redirects >= this.maxRedirects) {
          throw new TagesschauNetworkError(
            `Too many redirects (>${this.maxRedirects}) for ${method} ${url}`,
          );
        }
        const location = response.headers["location"];
        if (typeof location !== "string" || location.length === 0) {
          throw new TagesschauNetworkError(
            `Redirect (HTTP ${status}) with no Location header for ${method} ${url}`,
          );
        }
        const previousUrl = url;
        const nextUrl = new URL(location, previousUrl);
        // Enforce http(s)-only on the redirect target here in the engine, not
        // only in the default transport: a custom transport gets no scheme guard
        // otherwise, so a hostile `Location: file:///…` (or ftp:, data:, …) would
        // be handed to it verbatim. Reject anything else as a typed error.
        if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
          throw new TagesschauNetworkError(
            `Refusing to follow redirect to unsupported scheme "${nextUrl.protocol}" (from ${method} ${previousUrl})`,
          );
        }
        url = nextUrl.toString();
        // Cross-origin hop: drop credential headers so they are never re-sent to
        // a host the caller did not intend to authenticate against. Same-origin
        // redirects (e.g. /homepage/ -> /homepage) keep all headers.
        if (new URL(url).origin !== new URL(previousUrl).origin) {
          headers = stripCredentialHeaders(headers);
        }
        redirects += 1;
        continue;
      }

      const contentType = String(response.headers["content-type"] ?? "");
      if (status < 200 || status >= 300) {
        throw this.toApiError(method, url, status, response.body);
      }

      return { data: response.body, contentType, status };
    }
  }

  /** Perform a GET expecting JSON and parse it into `T`. */
  async getJson<T>(path: string, query?: QueryParams): Promise<T> {
    const res = await this.request("GET", path, { query, accept: "application/json" });
    const text = res.data.toString("utf8");
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new TagesschauParseError(`Failed to parse JSON response from ${path}`, { cause });
    }
  }

  private toApiError(method: string, url: string, status: number, body: Buffer): TagesschauApiError {
    const text = body.toString("utf8");
    let detail: string | undefined;
    try {
      const parsed = JSON.parse(text) as { detail?: unknown; message?: unknown };
      if (parsed && typeof parsed.detail === "string") detail = parsed.detail;
      else if (parsed && typeof parsed.message === "string") detail = parsed.message;
    } catch {
      // Non-JSON error body; leave detail undefined.
    }
    // `detail` comes straight from the (attacker-controllable) response body and
    // ends up in the error message printed to stderr, so strip control characters
    // that could inject terminal escape sequences before it leaves the engine.
    if (detail !== undefined) detail = sanitizeServerText(detail);
    return new TagesschauApiError({ status, url, method, body: text, detail });
  }
}
