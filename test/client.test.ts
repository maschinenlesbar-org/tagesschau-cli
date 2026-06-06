import { test } from "node:test";
import assert from "node:assert/strict";
import { TagesschauClient } from "../src/client/client.js";
import { TagesschauApiError } from "../src/client/errors.js";
import { makeMockTransport, jsonResponse, constantJson } from "./helpers.js";

function clientWith(mt: ReturnType<typeof makeMockTransport>): TagesschauClient {
  return new TagesschauClient({ transport: mt.transport });
}

test("homepage hits /api2u/homepage/", async () => {
  const mt = constantJson({ news: [], regional: [] });
  await clientWith(mt).homepage();
  assert.equal(new URL(mt.last().url).pathname, "/api2u/homepage/");
});

test("news joins regions with commas and passes ressort", async () => {
  const mt = constantJson({ news: [], regional: [] });
  await clientWith(mt).news({ regions: ["1", "2", "9"], ressort: "wirtschaft" });
  const url = new URL(mt.last().url);
  assert.equal(url.pathname, "/api2u/news/");
  assert.equal(url.searchParams.get("regions"), "1,2,9");
  assert.equal(url.searchParams.get("ressort"), "wirtschaft");
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

test("a 404 raises TagesschauApiError with status 404", async () => {
  const mt = makeMockTransport(() => jsonResponse({}, 404));
  await assert.rejects(
    () => clientWith(mt).homepage(),
    (err) => err instanceof TagesschauApiError && err.status === 404,
  );
});
