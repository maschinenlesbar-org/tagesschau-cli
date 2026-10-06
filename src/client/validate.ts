// Input validation shared by the library and the CLI. Every rule about what a
// request may contain lives here (or next to the option it guards) as a pure,
// exported function, so the CLI calls the very same rule instead of keeping a copy.
//
// - A `Problem` returns the reason a value is invalid ("Expected a non-empty
//   value."), or `undefined` when it is valid. The CLI's commander parsers turn
//   that reason into an `InvalidArgumentError` (exit 1).
// - `assertValid` runs a `Problem` in the library and throws a
//   `TagesschauValidationError` ("Invalid <name>: <reason>") before any request is
//   made. Methods that return a promise call it inside the async body, so they
//   reject rather than throw synchronously; constructors throw.

import { RegionValues, RessortValues } from "./enums.js";
import { TagesschauValidationError } from "./errors.js";

/** A validation rule: the reason `value` is invalid, or `undefined` when it is valid. */
export type Problem<T = unknown> = (value: T) => string | undefined;

/**
 * Check `value` against `problem` and return it unchanged when it is valid.
 * Otherwise throw a {@link TagesschauValidationError} with the message
 * `Invalid <name>: <reason>`.
 */
export function assertValid<T>(name: string, value: T, problem: Problem<T>): T {
  const reason = problem(value);
  if (reason !== undefined) throw new TagesschauValidationError(`Invalid ${name}: ${reason}`);
  return value;
}

/**
 * Why a search text is unusable, or `undefined` when it is not blank. Checked after
 * the NFKC normalisation `search()` applies, so an ideographic space (U+3000) counts
 * as blank too. Upstream answers an empty `searchText` with HTTP 400 and runs a
 * whitespace-only one as is, so a blank or missing text never reaches the API.
 */
export function searchTextProblem(value: unknown): string | undefined {
  if (typeof value !== "string" || value.normalize("NFKC").trim() === "") {
    return "search text must not be empty.";
  }
  return undefined;
}

/** `Invalid <name> "<value>". Expected one of: …`, or `undefined` for an allowed value. */
function oneOfProblem(name: string, value: unknown, allowed: readonly string[]): string | undefined {
  // includes(), never a keyed lookup: "toString" must not pass as a known value.
  if ((allowed as readonly unknown[]).includes(value)) return undefined;
  return `Invalid ${name} "${String(value)}". Expected one of: ${allowed.join(", ")}.`;
}

/**
 * Why a `regions` entry is unusable, or `undefined` when it is one of the Bundesland
 * ids `RegionValues` ("1".."16", exactly as written there: no padding, no leading
 * zero, one id per entry). The API does not reject an unknown id.
 */
export function regionProblem(value: unknown): string | undefined {
  return oneOfProblem("region", value, RegionValues);
}

/** Why a `ressort` is unusable, or `undefined` when it is one of `RessortValues`. */
export function ressortProblem(value: unknown): string | undefined {
  return oneOfProblem("ressort", value, RessortValues);
}

/**
 * The largest value the search endpoint accepts for `pageSize` / `resultPage` (a
 * 32-bit int upstream): `resultPage=2147483648` came back as a bare HTTP 400.
 */
export const MAX_SEARCH_INT = 2_147_483_647;

/** `undefined` (omitted) or a safe integer in [min, max]; otherwise the reason. */
function intRangeProblem(value: unknown, min: number, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max) return undefined;
  return `expected an integer from ${min} to ${max}, got ${String(value)}.`;
}

/** Why a search `pageSize` is unusable: it must be an integer in 1..MAX_SEARCH_INT. */
export function pageSizeProblem(value: unknown): string | undefined {
  return intRangeProblem(value, 1, MAX_SEARCH_INT);
}

/** Why a search `resultPage` (0-based) is unusable: it must be an integer in 0..MAX_SEARCH_INT. */
export function resultPageProblem(value: unknown): string | undefined {
  return intRangeProblem(value, 0, MAX_SEARCH_INT);
}

/**
 * A base URL must not carry whitespace or control characters. `new URL()` trims
 * surrounding whitespace and drops tab/CR/LF silently, but the engine joins the
 * raw string to each request path, so "https://h/ " would request
 * `/%20/api2u/...` and a custom transport would see the raw value. Reject rather
 * than guess.
 */
export function baseUrlWhitespaceProblem(value: unknown): string | undefined {
  if (typeof value !== "string") return "Expected a string.";
  if (value !== value.trim()) return "A base URL cannot have surrounding whitespace.";
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return "A base URL cannot contain whitespace or control characters.";
  return undefined;
}

/**
 * Every rule for a base URL, in order: a non-blank string, no whitespace or control
 * characters (see {@link baseUrlWhitespaceProblem}), a parseable absolute URL, the
 * `http:` or `https:` scheme, and no query or fragment — request paths are appended
 * to the base URL as a string, so a `?` or `#` would swallow every path
 * (`http://h/?x=1` requests `/?x=1/api2u/news/`, `http://h/#f` requests `/`).
 * Userinfo is allowed (sent as Basic auth); a `%` in it must start a valid escape (`%25`
 * for a literal one), as it is decoded for the Authorization header. The reasons never
 * echo the URL, so a credential in it cannot leak.
 */
export function baseUrlProblem(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return "Expected an absolute http(s) URL.";
  const spacing = baseUrlWhitespaceProblem(value);
  if (spacing !== undefined) return spacing;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Expected an absolute http(s) URL.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `Unsupported scheme "${url.protocol}". Expected an http(s) URL.`;
  }
  if (/[?#]/.test(value)) return "A base URL cannot have a query (?) or fragment (#).";
  // Node decodes the userinfo into the Authorization header and throws "URI malformed" for a
  // "%" that isn't an escape — at request time, as a network error. Reject it here.
  for (const part of [url.username, url.password]) {
    try {
      decodeURIComponent(part);
    } catch {
      return 'The user name or password has a "%" that is not followed by two hex digits; write a literal "%" as %25.';
    }
  }
  return undefined;
}

/**
 * A value that ends up in an HTTP header (the User-Agent) must be a non-blank
 * string of Latin-1 characters without control characters (tab is allowed, as in
 * HTTP). A blank one would send an empty header; Node's HTTP layer would throw an
 * opaque "Invalid character in header content" at request time for the others, and
 * a custom transport would get a CR/LF through (header injection). Checked by char
 * code so the source stays free of control bytes.
 */
export function headerValueProblem(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return "Expected a non-empty value.";
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if ((c < 0x20 && c !== 0x09) || c === 0x7f) return "Value contains control characters.";
    if (c > 0xff) return "Value contains characters outside Latin-1 (above U+00FF).";
  }
  return undefined;
}
