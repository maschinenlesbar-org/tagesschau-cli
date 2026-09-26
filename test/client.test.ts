import { test } from "node:test";
import assert from "node:assert/strict";
import { TagesschauClient } from "../src/client/client.js";
import { TagesschauApiError, TagesschauError, TagesschauParseError } from "../src/client/errors.js";
import { makeMockTransport, jsonResponse, constantJson } from "./helpers.js";

function clientWith(mt: ReturnType<typeof makeMockTransport>): TagesschauClient {
  return new TagesschauClient({ transport: mt.transport });
}

test("homepage hits /api2u/homepage/", async () => {
  const mt = constantJson({ news: [], regional: [] });
  await clientWith(mt).homepage();
  assert.equal(new URL(mt.last().url).pathname, "/api2u/homepage/");
});

test("news joins regions with commas", async () => {
  const mt = constantJson({ news: [], regional: [] });
  await clientWith(mt).news({ regions: ["1", "2", "9"] });
  const url = new URL(mt.last().url);
  assert.equal(url.pathname, "/api2u/news/");
  assert.equal(url.searchParams.get("regions"), "1,2,9");
  assert.equal(url.searchParams.get("ressort"), null);
});

test("news passes ressort", async () => {
  const mt = constantJson({ news: [], regional: [] });
  await clientWith(mt).news({ ressort: "wirtschaft", regions: [] });
  const url = new URL(mt.last().url);
  assert.equal(url.searchParams.get("ressort"), "wirtschaft");
  assert.equal(url.searchParams.get("regions"), null);
});

test("news rejects ressort + regions (the API drops the regions) before any request", async () => {
  const mt = constantJson({ news: [], regional: [] });
  await assert.rejects(
    () => clientWith(mt).news({ regions: ["2"], ressort: "inland" }),
    (err) => err instanceof TagesschauError && /cannot be combined/.test(err.message),
  );
  assert.equal(mt.calls.length, 0);
});

test("news with no params sends no query", async () => {
  const mt = constantJson({ news: [], regional: [] });
  await clientWith(mt).news();
  assert.equal(new URL(mt.last().url).search, "");
});

test("channels hits /api2u/channels/", async () => {
  const mt = constantJson({ channels: [] });
  await clientWith(mt).channels();
  assert.equal(new URL(mt.last().url).pathname, "/api2u/channels/");
});

test("search passes searchText and paging", async () => {
  const mt = constantJson({ searchResults: [] });
  await clientWith(mt).search({ searchText: "Bundestag", pageSize: 2, resultPage: 10 });
  const url = new URL(mt.last().url);
  assert.equal(url.pathname, "/api2u/search/");
  assert.equal(url.searchParams.get("searchText"), "Bundestag");
  assert.equal(url.searchParams.get("pageSize"), "2");
  assert.equal(url.searchParams.get("resultPage"), "10");
});

test("search sends the text in composed form (NFKC): a decomposed umlaut finds the same hits", async () => {
  const mt = constantJson({ searchResults: [] });
  await clientWith(mt).search({ searchText: "Ko\u0308ln \uFF16\uFF10" });
  assert.equal(new URL(mt.last().url).searchParams.get("searchText"), "Köln 60");
  assert.match(mt.last().url, /searchText=K%C3%B6ln%2060/);
});

test("a 404 raises TagesschauApiError with status 404", async () => {
  const mt = makeMockTransport(() => jsonResponse({}, 404));
  await assert.rejects(
    () => clientWith(mt).homepage(),
    (err) => err instanceof TagesschauApiError && err.status === 404,
  );
});

test("a 2xx body without the documented envelope is a TagesschauParseError", async () => {
  const cases: Array<[(c: TagesschauClient) => Promise<unknown>, unknown, string]> = [
    [(c) => c.homepage(), null, 'from /api2u/homepage/: expected a JSON object with a "news" array.'],
    [(c) => c.homepage(), [], 'from /api2u/homepage/: expected a JSON object with a "news" array.'],
    [(c) => c.news(), {}, 'from /api2u/news/: expected a JSON object with a "news" array.'],
    [(c) => c.news(), { news: [], regional: "x" }, 'from /api2u/news/: expected "regional" to be an array.'],
    [(c) => c.channels(), { channels: {} }, 'from /api2u/channels/: expected a JSON object with a "channels" array.'],
    [(c) => c.search({ searchText: "x" }), "text", 'from /api2u/search/: expected a JSON object with a "searchResults" array.'],
    [(c) => c.search({ searchText: "x" }), { searchResults: [], totalItemCount: -1 }, "from /api2u/search/: expected a non-negative integer totalItemCount."],
  ];
  for (const [call, body, message] of cases) {
    const mt = constantJson(body);
    await assert.rejects(
      () => call(clientWith(mt)),
      (err) => err instanceof TagesschauParseError && err.message === `Unexpected response shape ${message}`,
      JSON.stringify(body),
    );
  }
  // A body without the optional keys passes.
  assert.deepEqual(await clientWith(constantJson({ news: [] })).news(), { news: [] });
});

test("news passes the nextPage date cursor and validates it before any request", async () => {
  const mt = constantJson({ news: [], regional: [] });
  await clientWith(mt).news({ regions: ["5", "9"], date: "260923" });
  const url = new URL(mt.last().url);
  assert.equal(url.searchParams.get("date"), "260923");
  assert.equal(url.searchParams.get("regions"), "5,9");
  for (const bad of ["2609", "20260925", "261301", "260230", "26-09-25", ""]) {
    const m = constantJson({ news: [], regional: [] });
    await assert.rejects(
      () => clientWith(m).news({ date: bad }),
      (err) => err instanceof TagesschauError && err.message.startsWith(`Invalid date ${JSON.stringify(bad)}: expected YYMMDD`),
      bad,
    );
    assert.equal(m.calls.length, 0);
  }
});
