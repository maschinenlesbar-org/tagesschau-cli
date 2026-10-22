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
import { TagesschauValidationError, quoteValue } from "./errors.js";

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
 * A search text as the API matches it, the one canonical form the library sends and every
 * rule reads: in NFKC and without surrounding whitespace. NFKC, not only NFC, is deliberate:
 * the API finds nothing for a decomposed umlaut ("Ko" + U+0308, as pasted from macOS file
 * names or PDFs), and NFKC also folds fullwidth digits and ligatures ("ﬁ" to "fi"). A text
 * pasted with a trailing space or newline went out as typed. Inner whitespace is kept.
 * Normalised first, then trimmed, so a character NFKC turns into a space is trimmed too.
 */
export function normalizeText(value: string): string {
  return value.normalize("NFKC").trim();
}

/** Characters that never make a value non-blank: whitespace, controls, format characters, combining marks. */
const INVISIBLE = /[\s\p{Cc}\p{Cf}\p{M}]/gu;

/** A lone surrogate: half of a character, which URLSearchParams would send as U+FFFD. */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/**
 * True when nothing in `value` would match anything: it holds only whitespace, control and
 * format characters (a zero-width space, a soft hyphen) and combining marks. Such a value reads
 * as "no filter" upstream, or matches nothing, so it is refused as blank.
 */
function isBlank(value: string): boolean {
  return value.replace(INVISIBLE, "") === "";
}

/** `U+200B` for the first character of `text` that `pattern` matches. */
function codePointOf(text: string, pattern: RegExp): string {
  const ch = pattern.exec(text)?.[0] ?? "";
  return `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/** A control character inside a text: C0 and C1, but not TAB, LF or CR (whitespace in a pasted phrase). */
const TEXT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

/** A format character inside a text, but not ZWNJ/ZWJ (U+200C/U+200D), which some scripts and emoji need. */
const TEXT_FORMAT = /(?![\u200c\u200d])\p{Cf}/u;

/**
 * Why `value` cannot be sent as free text, or undefined when it can. Refused, before any
 * request, as the API would match nothing or everything:
 * - a value that is blank once trimmed (Unicode whitespace, U+00A0 included), or that holds only
 *   invisible characters and combining marks (`isBlank`);
 * - a lone surrogate (half of a character, sent as U+FFFD);
 * - a control character (but TAB, LF and CR) or a format character (a zero-width space, a soft
 *   hyphen, a bidi control; ZWNJ and ZWJ are allowed): pasted along, it makes the search find
 *   nothing (upstream ignores a zero-width space inside a word, but a text of nothing else
 *   found "no coverage").
 * The reason quotes the value with every invisible character escaped (`quoteValue`).
 */
export function textProblem(value: string): string | undefined {
  if (typeof value !== "string") return "Expected a string.";
  if (isBlank(value)) return "Expected a non-empty value.";
  if (LONE_SURROGATE.test(value)) return `${quoteValue(value)} contains half of a character (a lone surrogate).`;
  if (TEXT_CONTROL.test(value)) return `${quoteValue(value)} contains a control character (${codePointOf(value, TEXT_CONTROL)}).`;
  if (TEXT_FORMAT.test(value)) return `${quoteValue(value)} contains an invisible character (${codePointOf(value, TEXT_FORMAT)}).`;
  return undefined;
}

/** A control or format character in a token (after trimming): every Cc and every Cf. */
const TOKEN_INVISIBLE = /[\p{Cc}\p{Cf}]/u;

/**
 * Why `value` cannot be sent as a token, or undefined when it can. A token is a code the API
 * compares exactly: a region id, a Ressort, the `date` cursor. The rules apply to the value with
 * surrounding whitespace trimmed, as it is sent ({@link normalizeToken}): not blank (and not only
 * invisible characters or combining marks), no lone surrogate, and no control or format
 * character at all (a zero-width space, ZWJ, a soft hyphen, a bidi control), since an invisible
 * character in a code only ever makes it match nothing. The reason quotes the value visibly.
 * Each code is then checked against its allow-list or syntax (`regionProblem`,
 * `ressortProblem`, `newsDateProblem`).
 */
export function tokenProblem(value: string): string | undefined {
  if (typeof value !== "string") return "Expected a string.";
  if (isBlank(value)) return "Expected a non-empty value.";
  const token = value.trim();
  if (LONE_SURROGATE.test(token)) return `${quoteValue(value)} contains half of a character (a lone surrogate).`;
  if (TOKEN_INVISIBLE.test(token)) {
    return `${quoteValue(value)} contains an invisible or control character (${codePointOf(token, TOKEN_INVISIBLE)}).`;
  }
  return undefined;
}

/** A token as it is sent: trimmed and in composed Unicode (NFC). Check it with {@link tokenProblem} first. */
export function normalizeToken(value: string): string {
  return value.trim().normalize("NFC");
}

/**
 * Why a search text is unusable, or `undefined` when it can be sent. Blank — checked on the
 * canonical form `search()` sends ({@link normalizeText}), so an ideographic space (U+3000), a
 * zero-width space alone, combining marks alone or a "¨" (NFKC: a space and U+0308) count as
 * blank too — is "search text must not be empty."; upstream answers an empty `searchText` with
 * HTTP 400 and runs a whitespace-only or invisible one as is, finding nothing. Otherwise the
 * {@link textProblem} rules on the text as typed: a lone surrogate, a control character or a
 * format character (but ZWNJ/ZWJ) is refused, quoted visibly (`search text "a\u200bb" contains
 * an invisible character (U+200B).`), never sent.
 */
export function searchTextProblem(value: unknown): string | undefined {
  if (typeof value !== "string" || isBlank(normalizeText(value))) {
    return "search text must not be empty.";
  }
  const problem = textProblem(value);
  return problem === undefined ? undefined : `search text ${problem}`;
}

/**
 * A parameter object must be a plain object (or `undefined`, for "none") whose own keys
 * are all in `known`. A misspelled or unknown key (`region` for `regions`, `Ressort`), or a
 * `__proto__` key from `JSON.parse`, used to be ignored without a word, so
 * `news({ region: ["9"] })` returned the national feed as if it were Niedersachsen's.
 * Returns a `Problem` naming the first unknown key (cut, JSON-quoted) and the known ones.
 */
export function knownKeysProblem(known: readonly string[]): Problem<unknown> {
  return (value) => {
    if (value === undefined) return undefined;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return "Expected an object.";
    for (const key of Object.keys(value)) {
      if (!known.includes(key)) {
        return `Unknown key ${quoteValue(key.slice(0, 60))}; expected one of ${known.join(", ")}.`;
      }
    }
    return undefined;
  };
}

/**
 * `regions` must be an array (or `undefined`): a `Set` passed the per-id check, then was
 * dropped because it has no `length`, and a string was read character by character
 * (`"10"` as the ids "1" and "0"). The ids themselves are checked by `regionProblem`.
 */
export function regionsProblem(value: unknown): string | undefined {
  if (value === undefined || Array.isArray(value)) return undefined;
  return 'expected an array of Bundesland ids ("1".."16"), e.g. ["9"].';
}

/**
 * A note for a search text that may be an ASCII transliteration of ä, ö, ü or ß, or
 * `undefined`. The search endpoint folds case (`köln` = `Köln`) but matches spellings
 * literally: on 2026-10-05 `Strasse` found 88 hits against 582 for `Straße`, and `Koeln`
 * 210 against 388 for `Köln`, all with exit 0 — so a user without umlauts on the keyboard,
 * or an agent writing ASCII, reports a major topic as a niche one. The client cannot
 * search the variants itself: `ss` is a real `ss` as often as a `ß` (Russland, Wasser),
 * and each extra request costs from a budget of 60 an hour. So the note is a hint: it is
 * given when the text has no letter outside ASCII and contains `ae`, `oe`, `ue` (not after
 * `a`, `e` or `q`, as in Steuer, Bauer, Quelle) or `ss`. It never repeats the text.
 */
export function searchSpellingHint(searchText: string): string | undefined {
  const text = normalizeText(searchText).toLowerCase();
  if (/[^\u0000-\u007f]/.test(text)) return undefined;
  if (!/ae|oe|(?<![aeq])ue|ss/.test(text)) return undefined;
  return (
    'Note: the search matches spellings literally ("Koeln" finds far fewer hits than "Köln", ' +
    '"Strasse" than "Straße"); if your text stands for ä, ö, ü or ß, search that spelling too.'
  );
}

/** `Invalid <name> "<value>". Expected one of: …`, or `undefined` for an allowed value. */
function oneOfProblem(name: string, value: unknown, allowed: readonly string[]): string | undefined {
  // includes(), never a keyed lookup: "toString" must not pass as a known value.
  if ((allowed as readonly unknown[]).includes(value)) return undefined;
  return `Invalid ${name} ${quoteValue(String(value))}. Expected one of: ${allowed.join(", ")}.`;
}

/**
 * Why a `regions` entry is unusable, or `undefined` when it is one of the Bundesland
 * ids `RegionValues` ("1".."16" once trimmed: no leading zero, no invisible character,
 * one id per entry). The API does not reject an unknown id.
 */
export function regionProblem(value: unknown): string | undefined {
  return codeProblem("region", value, RegionValues);
}

/** Why a `ressort` is unusable, or `undefined` when it is one of `RessortValues` (trimmed, case kept). */
export function ressortProblem(value: unknown): string | undefined {
  return codeProblem("ressort", value, RessortValues);
}

/**
 * A code of an allow-list: a string is a token ({@link tokenProblem}), compared as it is sent
 * ({@link normalizeToken}: trimmed, NFC; case is kept), anything else must match exactly.
 */
function codeProblem(name: string, value: unknown, allowed: readonly string[]): string | undefined {
  if (typeof value !== "string") return oneOfProblem(name, value, allowed);
  const problem = tokenProblem(value);
  if (problem !== undefined) return `Invalid ${name}: ${problem}`;
  return oneOfProblem(name, normalizeToken(value), allowed);
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
  return `expected an integer from ${min} to ${max}, got ${typeof value === "string" ? quoteValue(value) : String(value)}.`;
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
