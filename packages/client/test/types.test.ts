// Compile-time checks of the exported library types, and the runtime behaviour they promise.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TagesschauClient, RequestEngine } from "../src/index.js";
import { constantJson } from "./helpers.js";

// Runs the TypeScript compiler over a consumer file.
const STARTS_A_PROCESS = { timeout: 30_000 };
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const INDEX = fileURLToPath(new URL("../src/index.js", import.meta.url));

test("a consumer with the strictest compiler settings can pass undefined for any option", STARTS_A_PROCESS, async () => {
  // Under exactOptionalPropertyTypes, `{ baseUrl: process.env.X }` fails to compile against an
  // option declared `?: string`, although the runtime treats undefined as omitted.
  const dir = mkdtempSync(join(tmpdir(), "tagesschau-types-"));
  try {
    writeFileSync(
      join(dir, "use.ts"),
      [
        `import { TagesschauClient, RequestEngine, type EngineOptions, type NewsParams, type SearchParams } from ${JSON.stringify(INDEX)};`,
        "declare function allUndefined<T>(): { [K in keyof T]-?: undefined };",
        "export const options: EngineOptions = allUndefined<EngineOptions>();",
        "export const newsParams: NewsParams = allUndefined<NewsParams>();",
        "export const searchParams: SearchParams = { searchText: \"Wahl\", pageSize: undefined, resultPage: undefined };",
        "export const client = new TagesschauClient({ baseUrl: process.env.TAGESSCHAU_BASE_URL, timeoutMs: 15_000 });",
        "export const engine = new RequestEngine({ userAgent: process.env.TAGESSCHAU_USER_AGENT });",
        "export const raw = () => engine.request(\"GET\", \"/x\", { query: undefined, accept: \"application/json\" });",
        "export const hits = async (): Promise<number> => (await client.search({ searchText: \"Wahl\", pageSize: process.env.N === undefined ? undefined : 5 })).searchResults.length;",
        "export const news = async (): Promise<number> => (await client.news({ ressort: undefined, regions: undefined, date: process.env.D })).news.length;",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          module: "nodenext",
          moduleResolution: "nodenext",
          target: "es2022",
          noEmit: true,
          skipLibCheck: false,
          types: ["node"],
          typeRoots: [join(ROOT, "node_modules/@types")],
        },
        files: ["use.ts"],
      }),
    );
    const tsc = join(ROOT, "node_modules/typescript/bin/tsc");
    const result = await new Promise<{ code: number; out: string }>((resolve) => {
      execFile(process.execPath, [tsc, "-p", join(dir, "tsconfig.json")], (err, stdout, stderr) =>
        resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: stdout + stderr }),
      );
    });
    assert.equal(result.code, 0, result.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an option given as undefined means its default, as an omitted one does", async () => {
  const mt = constantJson({ news: [], regional: [], searchResults: [] });
  const client = new TagesschauClient({
    baseUrl: undefined,
    userAgent: undefined,
    timeoutMs: undefined,
    maxRetries: undefined,
    retryDelayMs: undefined,
    maxRedirects: undefined,
    maxResponseBytes: undefined,
    sleep: undefined,
    onRetry: undefined,
    onWarning: undefined,
    bigIntegerKeys: undefined,
    transport: mt.transport,
  });
  await client.news({ regions: undefined, ressort: undefined, date: undefined });
  await client.search({ searchText: "Wahl", pageSize: undefined, resultPage: undefined });
  const [news, search] = mt.calls;
  assert.equal(news!.url, "https://www.tagesschau.de/api2u/news/");
  assert.equal(search!.url, "https://www.tagesschau.de/api2u/search/?searchText=Wahl");
  assert.equal(news!.headers?.["User-Agent"], "tagesschau-cli");
  assert.equal(news!.timeoutMs, 30_000);
  assert.equal(news!.maxResponseBytes, 100 * 1024 * 1024);

  const raw = constantJson({ ok: 1 });
  await new RequestEngine({ transport: raw.transport }).request("GET", "/x", { query: undefined, accept: "application/json" });
  assert.equal(raw.calls[0]!.url, "https://www.tagesschau.de/x");
});
