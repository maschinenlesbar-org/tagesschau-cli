// The request engine: turns logical (method, path, query) calls into HTTP
// requests via a Transport, applies retry/backoff for transient statuses
// (429, 503), and decodes responses.

import { MAX_TIMEOUT_MS, nodeHttpTransport, type Transport } from "./http.js";
import { buildQueryString, type QueryParams } from "./query.js";
import {
  TagesschauApiError,
  TagesschauError,
  TagesschauNetworkError,
  TagesschauParseError,
  redactUrl,
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

/**
 * Options for {@link RequestEngine} and the client. The numeric options must be
 * integers within their documented range; anything else (negative, fractional,
 * NaN, Infinity, too large) makes the constructor throw a TagesschauError.
 */
export interface EngineOptions {
  /** Base URL of the API. Defaults to https://www.tagesschau.de */
  baseUrl?: string;
  /** Swappable transport. Defaults to the built-in node http/https transport. */
  transport?: Transport;
  /** Value of the User-Agent header. */
  userAgent?: string;
  /**
   * Time limit per request in milliseconds, covering the whole response body, not
   * only idle gaps (0 disables; at most MAX_TIMEOUT_MS, 2^31 - 1 ms). Defaults to 30 s.
   */
  timeoutMs?: number;
  /**
   * Number of automatic retries for transient (429/503) responses, 0..`MAX_RETRIES`
   * (10). Each waits the
   * response's `Retry-After` (up to `MAX_RETRY_AFTER_MS`; a longer one is not
   * retried), or else `retryDelayMs * attempt`.
   */
  maxRetries?: number;
  /**
   * Base backoff between retries in milliseconds (grows linearly); used without a
   * Retry-After. At most `MAX_RETRY_AFTER_MS`.
   */
  retryDelayMs?: number;
  /** Number of HTTP redirects (301/302/303/307/308) to follow, 0..`MAX_REDIRECTS` (20). Defaults to 5. */
  maxRedirects?: number;
  /**
   * Hard cap on response body size in bytes (defends against memory exhaustion
   * from a hostile/buggy endpoint). Defaults to 100 MiB; set to 0 for no limit.
   * At most `Number.MAX_SAFE_INTEGER`.
   */
  maxResponseBytes?: number;
  /** Injectable sleep, primarily for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RESPONSE_BYTES = 100 * 1024 * 1024;

/** Most automatic retries a caller may ask for (the CLI's --max-retries shares it). */
export const MAX_RETRIES = 10;

/** Most redirects a caller may let the engine follow (the Fetch standard's limit). */
export const MAX_REDIRECTS = 20;

/**
 * Read a numeric engine option: `undefined` gives the default; anything but an
 * integer in [0, max] throws. Without this a negative or NaN `timeoutMs` silently
 * disabled the timeout, and `maxRedirects: NaN` followed a redirect loop forever
 * (`redirects >= NaN` is never true).
 */
function intOption(name: string, value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new TagesschauError(
      `Invalid option ${name}: expected an integer from 0 to ${max}, got ${String(value)}.`,
    );
  }
  return value;
}

/**
 * Longest `Retry-After` the engine waits out before retrying a 429/503. When the
 * server asks for longer, the engine does not retry at all and surfaces the error at
 * once: retrying early would only land inside the window the server asked us to wait
 * out (the Tagesschau API allows 60 requests an hour), and a hostile value must not
 * stall the CLI.
 */
export const MAX_RETRY_AFTER_MS = 30_000;

/** An IMF-fixdate (RFC 9110 §5.6.7), the one HTTP-date form senders must generate. */
const IMF_FIXDATE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * Parse a `Retry-After` header into a delay in milliseconds (RFC 9110 §10.2.3):
 * either delay-seconds (`"120"`) or an HTTP-date (`"Wed, 21 Oct 2026 07:28:00 GMT"`,
 * turned into the time left from `now`; a date in the past gives 0).
 *
 * Returns `undefined` when the header is absent or malformed — negative (`"-1"`),
 * fractional (`"1.5"`), padded inside, any other date format — so the caller falls
 * back to its own backoff. The strict patterns matter: `Date.parse` alone would
 * read `"1.5"` as a date in 2001 and retry at once.
 */
export function parseRetryAfter(
  header: string | string[] | undefined,
  now: number = Date.now(),
): number | undefined {
  const value = (Array.isArray(header) ? header[0] : header)?.trim();
  if (value === undefined || value === "") return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  if (!IMF_FIXDATE.test(value)) return undefined;
  const when = Date.parse(value);
  return Number.isNaN(when) ? undefined : Math.max(0, when - now);
}

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
 * Reject a base URL whose scheme is not http(s), or that has a query or fragment.
 * The default transport already gates the scheme per hop, but the engine is
 * exported as a library and may be handed a custom transport that does no such
 * check, so gate the configured base URL here too (a `file:`/`ftp:` base URL fails
 * fast with a typed error). Request paths are appended to the base URL as a string,
 * so a `?` or `#` in it would swallow every path: `http://h/?x=1` requests
 * `/?x=1/api2u/news/` and `http://h/#f` requests `/`.
 */
function assertHttpScheme(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new TagesschauNetworkError(`Invalid base URL: ${redactUrl(baseUrl)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TagesschauNetworkError(
      `Unsupported protocol "${url.protocol}" in base URL: ${redactUrl(baseUrl)}`,
    );
  }
  if (/[?#]/.test(baseUrl)) {
    throw new TagesschauNetworkError(`Base URL must not contain a query or fragment: ${redactUrl(baseUrl)}`);
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
    this.timeoutMs = intOption("timeoutMs", options.timeoutMs, 30_000, MAX_TIMEOUT_MS);
    this.maxRetries = intOption("maxRetries", options.maxRetries, 2, MAX_RETRIES);
    this.retryDelayMs = intOption("retryDelayMs", options.retryDelayMs, 200, MAX_RETRY_AFTER_MS);
    this.maxRedirects = intOption("maxRedirects", options.maxRedirects, 5, MAX_REDIRECTS);
    this.maxResponseBytes = intOption(
      "maxResponseBytes",
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      Number.MAX_SAFE_INTEGER,
    );
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
        // Honour Retry-After; without a usable one, back off linearly. A Retry-After
        // beyond MAX_RETRY_AFTER_MS is not retried: the error below surfaces at once.
        const retryAfter = parseRetryAfter(response.headers["retry-after"]);
        if (retryAfter === undefined || retryAfter <= MAX_RETRY_AFTER_MS) {
          attempt += 1;
          await this.sleep(retryAfter ?? this.retryDelayMs * attempt);
          continue;
        }
      }

      // Follow redirects, resolving the Location relative to the current URL.
      if (status >= 300 && status < 400) {
        if (redirects >= this.maxRedirects) {
          throw new TagesschauNetworkError(
            `Too many redirects (>${this.maxRedirects}) for ${method} ${redactUrl(url)}`,
          );
        }
        const location = response.headers["location"];
        if (typeof location !== "string" || location.length === 0) {
          throw new TagesschauNetworkError(
            `Redirect (HTTP ${status}) with no Location header for ${method} ${redactUrl(url)}`,
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
            `Refusing to follow redirect to unsupported scheme "${nextUrl.protocol}" (from ${method} ${redactUrl(previousUrl)})`,
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
      // `error` is the reason phrase of a Spring-style body
      // ({timestamp, status, error, path}), which the search endpoint sends on a 400.
      const parsed = JSON.parse(text) as { detail?: unknown; message?: unknown; error?: unknown };
      if (parsed && typeof parsed.detail === "string") detail = parsed.detail;
      else if (parsed && typeof parsed.message === "string") detail = parsed.message;
      else if (parsed && typeof parsed.error === "string") detail = parsed.error;
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
