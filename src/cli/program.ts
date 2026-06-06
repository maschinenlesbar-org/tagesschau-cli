// Assemble the full commander program. The program is built around an injectable
// CliDeps so the entire CLI can be driven in tests with a mocked client and
// captured output.

import { Command } from "commander";
import type { CliDeps } from "./io.js";
import { defaultIO } from "./io.js";
import { TagesschauClient } from "../client/client.js";
import { parseIntArg } from "./shared.js";
import { registerNewsCommands } from "./commands/news.js";

export const VERSION = "1.0.0";

/** Default dependencies: real client + real stdout/stderr/filesystem. */
export const defaultDeps: CliDeps = {
  io: defaultIO,
  createClient: (options) => new TagesschauClient(options),
};

export function buildProgram(deps: CliDeps = defaultDeps): Command {
  const program = new Command();

  program
    .name("tagesschau")
    .description("CLI for the open Tagesschau news API (https://www.tagesschau.de/api2u)")
    .version(VERSION)
    .option("--base-url <url>", "API base URL", "https://www.tagesschau.de")
    .option("--timeout <ms>", "per-request timeout in milliseconds", parseIntArg)
    .option("--user-agent <ua>", "User-Agent header value")
    .option("--max-retries <n>", "retries for transient 429/503 responses", parseIntArg)
    .option(
      "--max-redirects <n>",
      "max HTTP redirects to follow (default 5; credential headers are dropped on cross-origin hops)",
      parseIntArg,
    )
    .option(
      "--max-response-bytes <n>",
      "cap response body size in bytes (0 = unlimited; default 100 MiB)",
      parseIntArg,
    )
    .option("--compact", "print JSON on a single line instead of pretty-printed")
    .showHelpAfterError();

  registerNewsCommands(program, deps);

  return program;
}
