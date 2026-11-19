// This server's tools against a mock of the Tagesschau API (the client's live answers of
// 2026-11-19), with the skills' traps as cases: each tool answers through the protocol (its
// structuredContent checked by the SDK against its output schema), breaking news leads and the
// sport feed is sorted and listed once, a state is one request of its own and Frankfurt is
// ambiguous, a topic within a state is filtered here, the search page is 1-based, the streams
// keep every protocol, an article comes a page of blocks at a time, and every result carries its
// request and the editorial content's terms. The rules every server follows are the conformance
// tests (M1–M10).

import { test } from "node:test";
import assert from "node:assert/strict";
import { listTools } from "../src/mcp/server.js";
import { connect } from "./harness.js";
import { HOMEPAGE_NEWS, tagesschauApi, variant } from "./helpers.js";

const API = "https://www.tagesschau.de/api2u";

test("six tools: the four use cases, then the news feed and an article's text", () => {
  assert.deepEqual(listTools().map((t) => t.name), ["getBriefing", "getRegionalNews", "getTopicCoverage", "getLiveStreams", "getNewsFeed", "getArticle"]);
});

test("getBriefing: breaking news first, the top stories as ranked; the source and the terms", async () => {
  const homepage = HOMEPAGE_NEWS.map((item, i) => (i === 2 ? variant(item, { breakingNews: true }) : item));
  const connection = await connect({ transport: tagesschauApi({ homepage }) });
  const result = await connection.call("getBriefing", {});
  const content = result.structuredContent ?? {};
  assert.equal(content["status"], "ok", result.content[0]?.text);
  assert.deepEqual((content["breaking"] as { sophoraId: string }[]).map((h) => h.sophoraId), ["gipfel-trump-putin-xi-shenzhen-100"]);
  assert.equal((content["topStories"] as unknown[]).length, 9);
  assert.equal(content["source"], `${API}/homepage/`);
  assert.match(String(content["licence"]), /^Quelle: tagesschau\.de \(ARD-aktuell \/ NDR\).*private, non-commercial.*https:\/\/www\.tagesschau\.de\/nutzungsbedingungen$/);
  await connection.close();
});

test("getBriefing: the sport feed newest first, each item once, filed under sport; the source names both requests", async () => {
  const transport = tagesschauApi();
  const connection = await connect({ transport });
  const content = (await connection.call("getBriefing", { ressorts: ["sport"], topStories: true, perRessort: 4 })).structuredContent ?? {};
  assert.deepEqual(content["ressorts"], [{ ressort: "sport", items: 12, repeatsDropped: 2, alreadyListed: 0, unique: 10, shown: 4, more: 6 }]);
  assert.ok((content["ressortStories"] as { group: string }[]).every((h) => h.group === "sport"));
  assert.equal(content["source"], `${API}/{homepage/,news/?ressort=sport}`);
  assert.equal(transport.calls.length, 2);
  const tooMany = await connection.call("getBriefing", { ressorts: ["inland", "ausland", "wirtschaft", "wissen"] });
  assert.equal(tooMany.isError, true);
  assert.equal(transport.calls.length, 2);
  await connection.close();
});

test("getRegionalNews: a state by city, one request each; Frankfurt is ambiguous with candidates; a topic is filtered here", async () => {
  const transport = tagesschauApi();
  const connection = await connect({ transport });
  const berlin = (await connection.call("getRegionalNews", { states: ["BE"], perState: 3 })).structuredContent ?? {};
  assert.equal(berlin["status"], "ok");
  assert.equal(berlin["source"], `${API}/news/?regions=3`);
  assert.equal((berlin["stories"] as unknown[]).length, 3);
  assert.match((berlin["notes"] as string[]).join(" "), /Berlin and Brandenburg come as a pair/);
  const two = (await connection.call("getRegionalNews", { states: ["Köln", "Leipzig"] })).structuredContent ?? {};
  assert.equal(two["source"], `${API}/news/?regions={10,13}`);
  assert.deepEqual((two["states"] as { name: string }[]).map((s) => s.name), ["Nordrhein-Westfalen", "Sachsen"]);
  const before = transport.calls.length;
  const frankfurt = (await connection.call("getRegionalNews", { states: ["Frankfurt"] })).structuredContent ?? {};
  assert.equal(frankfurt["status"], "ambiguous");
  assert.equal((frankfurt["candidates"] as unknown[]).length, 2);
  assert.equal(transport.calls.length, before);
  const topic = (await connection.call("getRegionalNews", { states: ["Berlin"], topic: "Sperrmüll" })).structuredContent ?? {};
  assert.deepEqual((topic["stories"] as { sophoraId: string }[]).map((s) => s.sophoraId), ["rbb-bsr-dementiert-kostenlose-sperrmuell-abholung-102"]);
  const unknown = await connection.call("getRegionalNews", { states: ["Atlantis"] });
  assert.equal(unknown.isError, true);
  assert.match(unknown.content[0]?.text ?? "", /No Bundesland is named "Atlantis"/);
  await connection.close();
});

test("getTopicCoverage: the total, page 1 as resultPage 0 in the source, articles and videos apart", async () => {
  const connection = await connect({ transport: tagesschauApi() });
  const content = (await connection.call("getTopicCoverage", { query: "Bundestag", pageSize: 10 })).structuredContent ?? {};
  assert.equal(content["status"], "ok");
  assert.deepEqual([content["total"], content["pages"], content["nextPage"]], [109, 11, 2]);
  assert.deepEqual([(content["stories"] as unknown[]).length, (content["videos"] as unknown[]).length], [4, 6]);
  assert.equal(content["source"], `${API}/search/?searchText=Bundestag&pageSize=10&resultPage=0`);
  const none = (await connection.call("getTopicCoverage", { query: "Koeln Strasse" })).structuredContent ?? {};
  assert.equal(none["status"], "empty");
  assert.match(String(none["spellingNote"]), /Köln/);
  await connection.close();
});

test("getLiveStreams: the livestream first with its HLS link; a show not offered is empty with the titles", async () => {
  const connection = await connect({ transport: tagesschauApi() });
  const all = (await connection.call("getLiveStreams", {})).structuredContent ?? {};
  const first = (all["channels"] as { kind: string; hls: string }[])[0];
  assert.deepEqual([first?.kind, first?.hls], ["live", "https://tagesschau-live.ard-mcdn.de/tagesschau/live/hls/de/master.m3u8"]);
  assert.equal(all["source"], `${API}/channels/`);
  const none = (await connection.call("getLiveStreams", { show: "Sportschau" })).structuredContent ?? {};
  assert.equal(none["status"], "empty");
  assert.match(String(none["reason"]), /tagesthemen/);
  await connection.close();
});

test("getNewsFeed: a page of the feed with nextOffset and the older page's cursor; ressort and state together are a tool error", async () => {
  const transport = tagesschauApi();
  const connection = await connect({ transport });
  const content = (await connection.call("getNewsFeed", { state: "Berlin", limit: 4 })).structuredContent ?? {};
  assert.deepEqual([content["total"], content["nextOffset"], content["nextDate"]], [10, 4, "261112"]);
  assert.equal(content["source"], `${API}/news/?regions=3`);
  const older = (await connection.call("getNewsFeed", { state: "Berlin", date: "261112" })).structuredContent ?? {};
  assert.equal(older["status"], "empty");
  assert.equal(older["source"], `${API}/news/?date=261112&regions=3`);
  const both = await connection.call("getNewsFeed", { ressort: "sport", state: "Bayern" });
  assert.equal(both.isError, true);
  assert.equal(transport.calls.length, 2);
  await connection.close();
});

test("getArticle: the text a page of blocks at a time; an id that is gone is empty with the reason; a foreign URL is a tool error", async () => {
  const transport = tagesschauApi();
  const connection = await connect({ transport });
  const content = (await connection.call("getArticle", { article: "inland/innenpolitik/gipfel-koalition-willige-ukraine-100", limit: 3 })).structuredContent ?? {};
  assert.equal(content["status"], "ok");
  assert.deepEqual([(content["blocks"] as unknown[]).length, content["nextOffset"], content["blockCount"]], [3, 3, 9]);
  assert.equal(content["source"], `${API}/inland/innenpolitik/gipfel-koalition-willige-ukraine-100.json`);
  const gone = (await connection.call("getArticle", { article: "inland/weg-100" })).structuredContent ?? {};
  assert.equal(gone["status"], "empty");
  assert.match(String(gone["reason"]), /Depublizierung/);
  const foreign = await connection.call("getArticle", { article: "https://evil.example/api2u/x.json" });
  assert.equal(foreign.isError, true);
  assert.equal(transport.calls.length, 2);
  await connection.close();
});
