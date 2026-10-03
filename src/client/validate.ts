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
