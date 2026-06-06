import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli/run.js";
import { TagesschauClient } from "../src/client/client.js";
import type { CliDeps } from "../src/cli/io.js";
import type { HttpRequest, HttpResponse } from "../src/client/http.js";
import { makeMockTransport, jsonResponse } from "./helpers.js";

function makeCli(responder: (req: HttpRequest) => HttpResponse) {
  const out: string[] = [];
  const err: string[] = [];
  const mt = makeMockTransport(responder);

  const deps: CliDeps = {
    io: {
      out: (s) => out.push(s),
      err: (s) => err.push(s),
    },
    createClient: (opts) => new TagesschauClient({ ...opts, transport: mt.transport }),
  };
  return { deps, out, err, mt };
}

test("homepage hits the right path", async () => {
  const cli = makeCli(() => jsonResponse({ news: [], regional: [] }));
  const code = await run(["homepage"], cli.deps);
  assert.equal(code, 0);
  assert.equal(new URL(cli.mt.last().url).pathname, "/api2u/homepage/");
});

test("news --ressort + repeatable --region builds the query", async () => {
  const cli = makeCli(() => jsonResponse({ news: [], regional: [] }));
  const code = await run(
    ["news", "--ressort", "sport", "--region", "1", "--region", "9"],
    cli.deps,
  );
  assert.equal(code, 0);
  const url = new URL(cli.mt.last().url);
  assert.equal(url.searchParams.get("ressort"), "sport");
  assert.equal(url.searchParams.get("regions"), "1,9");
});

test("news rejects an invalid ressort before any request", async () => {
  const cli = makeCli(() => jsonResponse({}));
  const code = await run(["news", "--ressort", "klatsch"], cli.deps);
  assert.notEqual(code, 0);
  assert.equal(cli.mt.calls.length, 0);
  assert.match(cli.err.join("\n"), /Invalid ressort/);
});

test("news rejects an out-of-range region before any request", async () => {
  const cli = makeCli(() => jsonResponse({}));
  const code = await run(["news", "--region", "99"], cli.deps);
  assert.notEqual(code, 0);
  assert.equal(cli.mt.calls.length, 0);
});

test("search passes the text and paging options", async () => {
  const cli = makeCli(() => jsonResponse({ searchResults: [] }));
  await run(["search", "Wahl", "--result-page", "3"], cli.deps);
  const url = new URL(cli.mt.last().url);
  assert.equal(url.searchParams.get("searchText"), "Wahl");
  assert.equal(url.searchParams.get("resultPage"), "3");
});

test("a 404 from the API maps to exit code 4", async () => {
  const cli = makeCli(() => jsonResponse({}, 404));
  const code = await run(["channels"], cli.deps);
  assert.equal(code, 4);
});
