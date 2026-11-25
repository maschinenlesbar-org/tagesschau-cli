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
import http from "node:http";
import { nodeHttpTransport, type Transport } from "../src/mcp/api.js";
import { limitTransport } from "../src/mcp/limiter.js";
import { listTools } from "../src/mcp/server.js";
import { DEADLINE_HINT, SIZE_HINT, TOOLS } from "../src/mcp/tools.js";
import { connect } from "./harness.js";
import { ARTICLE, CHANNELS, HOMEPAGE_NEWS, tagesschauAnswer, tagesschauApi, variant } from "./helpers.js";

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
  assert.equal(content["source"], `${API}/homepage`);
  assert.match(String(content["licence"]), /^Quelle: tagesschau\.de \(ARD-aktuell \/ NDR\).*private, non-commercial.*https:\/\/www\.tagesschau\.de\/nutzungsbedingungen$/);
  await connection.close();
});

test("getBriefing: the sport feed newest first, each item once, filed under sport; the source names both requests", async () => {
  const transport = tagesschauApi();
  const connection = await connect({ transport });
  const content = (await connection.call("getBriefing", { ressorts: ["sport"], topStories: true, perRessort: 4 })).structuredContent ?? {};
  assert.deepEqual(content["ressorts"], [{ ressort: "sport", items: 12, repeatsDropped: 2, alreadyListed: 0, unique: 10, shown: 4, more: 6 }]);
  assert.ok((content["ressortStories"] as { group: string }[]).every((h) => h.group === "sport"));
  assert.equal(content["source"], `${API}/{homepage,news/?ressort=sport}`);
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
  assert.equal(frankfurt["source"], `${API}/news`, "no request was made for an ambiguous name");
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
  assert.equal(all["source"], `${API}/channels`);
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

test("getArticle: a long paragraph arrives whole, not cut at the 2000 characters of other upstream text", async () => {
  const long = `${"Ein langer Absatz. ".repeat(250)}Ende.`;
  const article = { ...ARTICLE, content: [{ type: "text", value: long }] };
  const connection = await connect({ transport: tagesschauApi({ articles: { "inland/lang-100": article } }) });
  const content = (await connection.call("getArticle", { article: "inland/lang-100" })).structuredContent ?? {};
  await connection.close();
  assert.equal((content["blocks"] as { text: string }[])[0]?.text, long.trim());
  assert.equal(content["truncated"], undefined);
});

test("getArticle: an offset past the last block is empty, saying how many blocks there are, as getNewsFeed says it", async () => {
  const connection = await connect({ transport: tagesschauApi() });
  for (const offset of [9, 5000]) {
    const past = (await connection.call("getArticle", { article: "inland/innenpolitik/gipfel-koalition-willige-ukraine-100", offset })).structuredContent ?? {};
    assert.equal(past["status"], "empty", String(offset));
    assert.match(String(past["reason"]), new RegExp(`holds 9 blocks; offset ${offset} is past its end`));
    assert.equal(past["blockCount"], 9);
  }
  await connection.close();
});

test("getRegionalNews: a state still loading at the call deadline is named as not read in time; the states read are the answer", async () => {
  // A real transport, as the server runs it (the limiter passes the call's signal to each request):
  // Berlin answers, Bremen never does. The call failed whole, after "Request timed out after 30000ms".
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.searchParams.get("regions") !== "3") return;
    const answer = tagesschauAnswer({ method: "GET", url: `https://www.tagesschau.de${req.url ?? "/"}` });
    res.writeHead(answer.status, { "content-type": "application/json" }).end(answer.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  try {
    const connection = await connect({ transport: { transport: limitTransport(nodeHttpTransport) }, config: { baseUrl: `http://127.0.0.1:${port}`, callTimeoutMs: 400 } });
    const result = await connection.call("getRegionalNews", { states: ["Berlin", "Bremen"] });
    await connection.close();
    const content = result.structuredContent ?? {};
    assert.equal(content["status"], "ok", result.content[0]?.text);
    assert.deepEqual((content["states"] as { name: string }[]).map((st) => st.name), ["Berlin"]);
    assert.match((content["notes"] as string[]).join(" "), /Not read: Bremen \(the call's time ran out, or it was cancelled, first\)/);
    assert.doesNotMatch(result.content[0]?.text ?? "", /timed out after 30000ms/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("links in an answer another host gave after a redirect are flagged as that host's, first, in every tool", async () => {
  // The client follows redirects, also to another host: a 302 from the channels to evil.example made
  // its https://evil.example/live.m3u8 the tagesschau24 HLS link, cited only in source.
  const evil = CHANNELS.map((c, i) => (i === 0 ? variant(c, { streams: { adaptivestreaming: "https://evil.example/live.m3u8" } }) : c));
  const api = tagesschauApi({ channels: evil });
  const answers: Transport = async (request) => {
    const url = new URL(request.url);
    if (url.host === "www.tagesschau.de" && (url.pathname === "/api2u/channels" || url.pathname.endsWith(".json"))) {
      return { status: 302, headers: { location: `https://evil.example${url.pathname}` }, body: Buffer.alloc(0) };
    }
    return api.transport({ ...request, url: `https://www.tagesschau.de${url.pathname}${url.search}` });
  };
  const connection = await connect({ transport: { transport: limitTransport(answers) } });
  const streams = (await connection.call("getLiveStreams", {})).structuredContent ?? {};
  assert.match(String(streams["unconfirmed"]), /^This answer came from https:\/\/evil\.example after a redirect, not from the Tagesschau API's own address: its links .* are that host's/);
  assert.match(String(streams["verdict"]), /^Unconfirmed \(answered by https:\/\/evil\.example after a redirect\): /);
  const article = (await connection.call("getArticle", { article: "inland/innenpolitik/gipfel-koalition-willige-ukraine-100" })).structuredContent ?? {};
  assert.match(String(article["unconfirmed"]), /evil\.example/);
  const own = (await connection.call("getBriefing", {})).structuredContent ?? {};
  assert.equal(own["unconfirmed"], undefined, "an answer from the API's own host is not flagged");
  await connection.close();
});

test("the deadline's and the size cap's advice fit every tool: each option named with the tools that take it", async () => {
  // One fixed text named perRessort, perState, pageSize and limit (and Ressorts, states, search
  // pages) for every tool, getLiveStreams included, which takes none of them.
  const hanging = { transport: (): Promise<never> => new Promise<never>(() => {}) };
  const connection = await connect({ transport: hanging, config: { callTimeoutMs: 30 } });
  const deadline = (await connection.call("getLiveStreams", {})).content[0]?.text ?? "";
  await connection.close();
  assert.match(deadline, /took longer than .* and was stopped/);
  assert.ok(deadline.includes(DEADLINE_HINT));
  const schemas = new Map(TOOLS.map((tool) => [tool.name, Object.keys((tool.inputSchema as { properties: Record<string, unknown> }).properties)]));
  for (const text of [DEADLINE_HINT, SIZE_HINT]) {
    const pairs = [...text.matchAll(/(\w+(?: or \w+)*) \((\w+(?:, \w+)*)\)/g)];
    assert.ok(pairs.length >= 3, text);
    for (const [, options, tools] of pairs) {
      for (const tool of (tools as string).split(", ")) {
        assert.ok(schemas.has(tool), `no tool ${tool}: ${text}`);
        for (const option of (options as string).split(" or ")) assert.ok(schemas.get(tool)?.includes(option), `${tool} takes no ${option}: ${text}`);
      }
    }
    const named = new Set(pairs.flatMap(([, options]) => (options as string).split(" or ")));
    for (const option of new Set([...schemas.values()].flat())) {
      assert.ok(!new RegExp(`\\b${option}\\b`).test(text) || named.has(option), `${option} named without its tools: ${text}`);
    }
    assert.match(text, /getLiveStreams/, "the tool that reads its list whole whatever is asked is named");
  }
});

test("the server's transport keeps to the API's 60 requests an hour", async () => {
  const { serverTransport } = await import("../src/mcp/api.js");
  let sent = 0;
  const base = () => {
    sent += 1;
    return Promise.resolve({ status: 200, headers: {}, body: Buffer.from("{}") });
  };
  const transport = serverTransport(base);
  const request = { method: "GET", url: "https://www.tagesschau.de/api2u/homepage/" };
  for (let i = 0; i < 60; i += 1) await transport(request);
  await assert.rejects(transport(request), /not sent: the Tagesschau API allows 60 requests an hour/);
  assert.equal(sent, 60);
});
