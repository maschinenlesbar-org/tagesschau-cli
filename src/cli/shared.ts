// Shared helpers used across CLI command groups: option parsers, the global
// option resolver, and the JSON result renderer.

import type { Command } from "commander";
import { InvalidArgumentError } from "commander";
import type { CliDeps } from "./io.js";
import { TagesschauError } from "../client/errors.js";
import type { EngineOptions } from "../client/engine.js";

/**
 * commander value-parser: a non-negative integer in plain decimal notation.
 *
 * Only digit strings are accepted. Bare `Number()` would silently coerce
 * empty/whitespace ("" -> 0, " 5 " -> 5), hexadecimal ("0x10" -> 16),
 * exponent ("1e3" -> 1000) and unsafe-magnitude values (precision loss), so we
 * validate the literal text first and bound the result to a safe integer.
 */
export function parseIntArg(value: string): number {
  if (!/^[0-9]+$/.test(value)) {
    throw new InvalidArgumentError("Expected a non-negative integer in decimal notation.");
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new InvalidArgumentError("Value is too large; expected a safe non-negative integer.");
  }
  return n;
}

/**
 * Build a commander value-parser for a decimal integer constrained to [min, max].
 * A well-formed number that is too large (even beyond 2^53) says so, rather than
 * the generic "too large; expected a safe integer" of parseIntArg.
 */
export function parseBoundedInt(min: number, max: number): (value: string) => number {
  return (value: string) => {
    if (!/^[0-9]+$/.test(value)) {
      throw new InvalidArgumentError("Expected a non-negative integer in decimal notation.");
    }
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n > max) throw new InvalidArgumentError(`Expected an integer <= ${max}.`);
    if (n < min) throw new InvalidArgumentError(`Expected an integer >= ${min}.`);
    return n;
  };
}

/**
 * The largest value the search endpoint accepts for `pageSize` / `resultPage`
 * (a 32-bit int upstream): `--result-page 2147483648` came back as a bare HTTP 400.
 */
export const MAX_SEARCH_INT = 2_147_483_647;

/**
 * commander value-parser for --page-size: 1..MAX_SEARCH_INT, since a page of zero
 * hits is meaningless.
 */
export const parsePagingArg = parseBoundedInt(1, MAX_SEARCH_INT);

/**
 * commander value-parser for --result-page: the page index is 0-based upstream,
 * so 0..MAX_SEARCH_INT.
 */
export const parseResultPage = parseBoundedInt(0, MAX_SEARCH_INT);

/**
 * commander value-parser for --base-url: an absolute http(s) URL. Anything else
 * (a `file:`/`ftp:` URL, or text that is not a URL at all) is a usage error at
 * parse time instead of reaching the transport.
 */
export function parseBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidArgumentError("Expected an absolute http(s) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InvalidArgumentError(
      `Unsupported scheme "${url.protocol}". Expected an http(s) URL.`,
    );
  }
  return value;
}

/**
 * Validate a positional argument against an allowed set (commander does not
 * support .choices() on positional args). Throws a TagesschauError so run() prints a
 * clear message and exits 1.
 */
export function assertEnum<T extends string>(
  value: string,
  allowed: readonly T[],
  argName: string,
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new TagesschauError(`Invalid ${argName} "${value}". Expected one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

export interface GlobalOptions {
  baseUrl?: string;
  timeout?: number;
  userAgent?: string;
  maxRetries?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  compact?: boolean;
}

/** Translate resolved global CLI options into client EngineOptions. */
export function toEngineOptions(global: GlobalOptions): EngineOptions {
  const options: EngineOptions = {};
  if (global.baseUrl !== undefined) options.baseUrl = global.baseUrl;
  if (global.timeout !== undefined) options.timeoutMs = global.timeout;
  if (global.userAgent !== undefined) options.userAgent = global.userAgent;
  if (global.maxRetries !== undefined) options.maxRetries = global.maxRetries;
  if (global.maxRedirects !== undefined) options.maxRedirects = global.maxRedirects;
  if (global.maxResponseBytes !== undefined) options.maxResponseBytes = global.maxResponseBytes;
  return options;
}

/**
 * Escape the control characters JSON.stringify leaves raw. It escapes C0 (including
 * ESC) but not DEL or the C1 range U+0080–U+009F, and terminals may act on those —
 * U+009B is the 8-bit form of CSI. The output is server data, so escape them; the
 * result is equivalent, valid JSON (these characters only occur inside strings).
 * Checked by char code so the source stays free of control bytes.
 */
export function escapeControlChars(json: string): string {
  let result = "";
  let from = 0;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    if (c >= 0x7f && c <= 0x9f) {
      result += json.slice(from, i) + "\\u" + c.toString(16).padStart(4, "0");
      from = i + 1;
    }
  }
  return from === 0 ? json : result + json.slice(from);
}

/** Render a JSON value to stdout, pretty by default, compact with --compact. */
export function renderJson(deps: CliDeps, global: GlobalOptions, value: unknown): void {
  const text = escapeControlChars(global.compact ? JSON.stringify(value) : JSON.stringify(value, null, 2));
  deps.io.out(text);
}

export interface ActionContext {
  client: ReturnType<CliDeps["createClient"]>;
  global: GlobalOptions;
  /** This command's own parsed options. */
  opts: Record<string, unknown>;
}

/**
 * Wrap an async command action with consistent global-option resolution and
 * client construction. The callback receives a context (client + resolved global
 * options + this command's options) and the command's positional arguments.
 *
 * Commander invokes actions as (arg1, ..., argN, options, command); we slice off
 * the trailing options object and command instance to recover the positionals.
 */
export function action(
  deps: CliDeps,
  fn: (ctx: ActionContext, positionals: string[]) => Promise<void>,
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const command = args[args.length - 1] as Command;
    const positionals = args.slice(0, Math.max(0, args.length - 2)) as string[];
    const global = command.optsWithGlobals() as GlobalOptions;
    const client = deps.createClient(toEngineOptions(global));
    await fn({ client, global, opts: command.opts() }, positionals);
  };
}
