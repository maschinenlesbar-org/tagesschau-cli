// The use cases (operations.ts) against the API's recorded answers (fixtures.ts), with the skills'
// traps as cases: breaking news leads, the homepage keeps its editorial order, Ressort feeds are
// sorted by date and listed once (the sport feed repeats items and carries no ressort), a state is
// resolved by name and read with one request of its own, Frankfurt is ambiguous, Berlin and
// Brandenburg come as a pair, a topic within a state is filtered here, the search page is 1-based
// and past its end says so, stories and videos are apart, a channel's streams are an object, and
// an article that is gone is empty with a reason.

import { test } from "node:test";
import assert from "node:assert/strict";
import { TagesschauClient } from "../src/client.js";
import type { JsonObject } from "../src/types.js";
import { TagesschauParseError, TagesschauValidationError } from "../src/errors.js";
import {
  broadcasterOf,
  fold,
  getArticle,
  getBriefing,
  getLiveStreams,
  getNewsFeed,
  getRegionalNews,
  getTopicCoverage,
  plainText,
  resolveState,
} from "../src/operations.js";
import { ARTICLE, CHANNELS, HOMEPAGE_NEWS, SEARCH_RESULTS, tagesschauApi, variant } from "./fixtures.js";
import { jsonResponse, makeMockTransport } from "./helpers.js";

const client = (mock: ReturnType<typeof tagesschauApi>) => new TagesschauClient({ transport: mock.transport });
/** The query of every request the mock saw, as `path?query`. */
const requests = (mock: ReturnType<typeof tagesschauApi>) => mock.calls.map((c) => { const u = new URL(c.url); return u.pathname + u.search; });
const NOW = () => new Date("2026-11-19T21:40:00+01:00");

// ---- getBriefing ----------------------------------------------------------------------------

test("briefing: the homepage's top stories in its editorial order, one request; no ressort is 'weitere', never a guess", async () => {
  const mock = tagesschauApi();
  const b = await getBriefing(client(mock));
  assert.equal(b.status, "ok");
  assert.deepEqual(requests(mock), ["/api2u/homepage"]);
  assert.equal(b.topStories.length, 10);
  assert.equal(b.topStories[0]?.sophoraId, "gipfel-koalition-willige-ukraine-100");
  assert.equal(b.topStories[0]?.firstSentence?.startsWith("Die \"Koalition der Willigen\""), true);
  assert.equal(b.topStories[0]?.articleId, "inland/innenpolitik/gipfel-koalition-willige-ukraine-100");
  assert.deepEqual(b.topStories.map((h) => h.group), ["inland", "weitere", "ausland", "wirtschaft", "wirtschaft", "ausland", "ausland", "wirtschaft", "ausland", "weitere"]);
  assert.equal(b.topStories[1]?.ressort, undefined);
  assert.equal(b.regionalLeftOut, 14);
  assert.match(b.verdict, /^no breaking news; 10 top stories$/);
});

test("briefing: an Eilmeldung leads, taken out of the top stories", async () => {
  const homepage = HOMEPAGE_NEWS.map((item, i) => (i === 3 ? variant(item, { breakingNews: true }) : item));
  const b = await getBriefing(client(tagesschauApi({ homepage })));
  assert.deepEqual(b.breaking.map((h) => h.sophoraId), ["anthropic-boersengang-ki-boom-100"]);
  assert.equal(b.breaking[0]?.breakingNews, true);
  assert.equal(b.topStories.length, 9);
  assert.ok(!b.topStories.some((h) => h.sophoraId === "anthropic-boersengang-ki-boom-100"));
  assert.match(b.verdict, /^1 breaking \(Eilmeldung\)/);
});

test("briefing: the sport feed is sorted newest first, its repeats dropped, its items grouped as sport though they carry no ressort", async () => {
  const mock = tagesschauApi();
  const b = await getBriefing(client(mock), { ressorts: ["Sport"] });
  assert.deepEqual(requests(mock), ["/api2u/news/?ressort=sport"], "no homepage: a ressort was asked");
  assert.deepEqual(b.topStories, []);
  assert.deepEqual(b.ressorts, [{ ressort: "sport", items: 12, repeatsDropped: 2, alreadyListed: 0, unique: 10, shown: 10, more: 0 }]);
  const dates = b.ressortStories.map((h) => Date.parse(h.date ?? ""));
  assert.deepEqual(dates, [...dates].sort((a, z) => z - a), "newest first");
  assert.equal(b.ressortStories[0]?.sophoraId, "smits-comeback-handball-em-frauen-100");
  assert.equal(b.ressortStories.at(-1)?.date, "2024-06-28T14:59:00.000+02:00");
  assert.ok(b.ressortStories.every((h) => h.group === "sport" && h.ressort === undefined && h.firstSentence === undefined));
  assert.match(b.notes.join(" "), /sportschau\.de/);
});

test("briefing: a Ressort feed's stories already among the top stories are not listed twice; perRessort cuts with a count", async () => {
  const mock = tagesschauApi();
  const b = await getBriefing(client(mock), { ressorts: ["wirtschaft", "sport"], topStories: true, perRessort: 3 });
  assert.deepEqual(requests(mock), ["/api2u/homepage", "/api2u/news/?ressort=wirtschaft", "/api2u/news/?ressort=sport"]);
  assert.deepEqual(b.ressorts[0], { ressort: "wirtschaft", items: 3, repeatsDropped: 0, alreadyListed: 3, unique: 0, shown: 0, more: 0 });
  assert.deepEqual([b.ressorts[1]?.shown, b.ressorts[1]?.more], [3, 7]);
  assert.equal(b.ressortStories.length, 3);
  assert.match(b.verdict, /3 of 10 sport \(7 more\)/);
});

test("briefing: more than three Ressorts, an unknown one or a bad perRessort is refused before any request", async () => {
  const mock = tagesschauApi();
  await assert.rejects(getBriefing(client(mock), { ressorts: ["inland", "ausland", "wirtschaft", "sport"] }), /At most 3 Ressorts/);
  await assert.rejects(getBriefing(client(mock), { ressorts: ["politik"] }), TagesschauValidationError);
  await assert.rejects(getBriefing(client(mock), { perRessort: 0 }), /perRessort must be an integer from 1 to 30/);
  assert.equal(mock.calls.length, 0);
});

test("briefing: empty feeds are an empty answer that implies no outage", async () => {
  const b = await getBriefing(client(tagesschauApi({ homepage: [], regional: [] })));
  assert.equal(b.status, "empty");
  assert.match(b.reason ?? "", /came back empty \(homepage\).*no outage/);
});

// ---- getRegionalNews ---------------------------------------------------------------------------

test("states are resolved by name, code, region id, English name and city; Sachsen is not Sachsen-Anhalt", () => {
  const ids = (q: string) => { const r = resolveState(q); return r.status === "ok" ? r.state.id : r.status; };
  assert.deepEqual(
    ["NRW", "bavaria", "Thuringen", "Thueringen", "sachsen-anhalt", "Sachsen", "10", "Köln", "Koeln", "Meck-Pomm", " Lower Saxony ", "frankfurt am main", "Frankfurt (Oder)"].map(ids),
    ["10", "2", "16", "16", "14", "13", "10", "10", "10", "8", "9", "7", "4"],
  );
  assert.equal(ids("Frankfurt"), "ambiguous");
  // Halle's written forms: the city on the Saale is Sachsen-Anhalt (the bare name too, the big
  // city), Halle (Westf.) is in Nordrhein-Westfalen.
  assert.deepEqual(["Halle (Saale)", "Halle/Saale", "Halle an der Saale", "Halle", "Halle (Westf.)", "Halle Westfalen"].map(ids), ["14", "14", "14", "14", "10", "10"]);
  assert.equal(ids("Atlantis"), "unknown");
  assert.equal(ids("constructor"), "unknown");
  assert.equal(ids("17"), "unknown");
});

test("regional: Berlin is one request of its own; its items carry Berlin and Brandenburg (rbb), said in a note, with the cursor", async () => {
  const mock = tagesschauApi();
  const r = await getRegionalNews(client(mock), { states: ["Berlin"] });
  assert.ok(r.status === "ok");
  assert.deepEqual(requests(mock), ["/api2u/news/?regions=3"]);
  assert.equal(r.stories.length, 10);
  assert.ok(r.stories.every((s) => s.state === "Berlin" && s.broadcaster === "rbb"));
  assert.deepEqual(r.stories[0]?.regions, ["Berlin", "Brandenburg"]);
  assert.deepEqual(r.states[0], { query: "Berlin", id: "3", name: "Berlin", items: 10, matched: 10, alsoUnder: 0, shown: 10, more: 0, broadcasters: ["rbb"], newest: "2026-11-19T20:38:17.000+01:00", nextDate: "261112" });
  assert.equal(r.verdict, "Berlin: 10 shown of 10, newest 2026-11-19");
  assert.match(r.notes.join(" "), /Berlin and Brandenburg come as a pair/);
});

test("regional: two states are two requests, never one shared page; an item listed under the first is not repeated", async () => {
  const mock = tagesschauApi();
  const r = await getRegionalNews(client(mock), { states: ["BE", "Brandenburg"] });
  assert.ok(r.status === "ok");
  assert.deepEqual(requests(mock), ["/api2u/news/?regions=3", "/api2u/news/?regions=4"]);
  const bb = r.states[1];
  assert.deepEqual([bb?.items, bb?.alsoUnder, bb?.shown], [2, 1, 1]);
  assert.deepEqual(r.stories.filter((s) => s.state === "Brandenburg").map((s) => s.sophoraId), ["strafbefehl-werksleiter-von-tesla-100"]);
});

test("regional: a topic is filtered here, said in a note; nothing matching is empty with what to change", async () => {
  const mock = tagesschauApi();
  const r = await getRegionalNews(client(mock), { states: ["3"], topic: "pergamonmuseum" });
  assert.ok(r.status === "ok");
  assert.deepEqual(r.stories.map((s) => s.sophoraId), ["rbb-ticketverkauf-fuer-wiedereroeffnung-des-pergamonmuseums-beginnt-im-dezember-102"]);
  assert.equal(r.states[0]?.matched, 1);
  assert.match(r.notes.join(" "), /Filtered here for "pergamonmuseum".*can't combine a region with a Ressort/);
  assert.deepEqual(requests(mock), ["/api2u/news/?regions=3"], "no ressort sent with the region");
  const none = await getRegionalNews(client(mock), { states: ["Berlin"], topic: "Hafen" });
  assert.equal(none.status, "empty");
  assert.match(none.status === "empty" ? (none.reason ?? "") : "", /None of Berlin's 10 current items mentions "Hafen"/);
});

test("regional: a topic matches words, never inside another word or across two", async () => {
  // The planted titles of the exploratory round and words of a live Berlin feed: "Eis" found
  // Bahnreisende and Preise, "Ost" found "kostet", "sus" found "Kreis Usedom".
  const titles = [
    "Eishockey: Straubing gewinnt", "Glatteis auf der A9", "Eis-Saison beginnt", "Preise steigen", "Reisewelle zu Ostern", "Bahnreisende warten",
    "Ameisenart entdeckt", "Bezirksbürgermeister gewählt", "Kreis Usedom", "Frau in Straubing", "Autobahn gesperrt", "Studienrente kommt",
    "Was kostet der Winter?", "Auswahl der Woche", "Wahlkampf in Bayern", "Landtagswahlen 2026", "Die Wahl ist vorbei", "Deutschen Bahn streikt",
  ];
  const feed = titles.map((title, i) => variant(HOMEPAGE_NEWS[0], { sophoraId: `t-${i}`, title, topline: "", firstSentence: "", tags: [], regionIds: [2], shareURL: `https://www.br.de/${i}` }));
  const mock = tagesschauApi({ regions: { "2": feed } });
  const matching = async (topic: string): Promise<string[]> => {
    const r = await getRegionalNews(client(mock), { states: ["Bayern"], topic, perState: 30 });
    return r.status === "ambiguous" ? [] : r.stories.map((s) => s.title).sort();
  };
  assert.deepEqual(await matching("Eis"), ["Eis-Saison beginnt", "Eishockey: Straubing gewinnt"]);
  assert.deepEqual(await matching("Ost"), ["Reisewelle zu Ostern"], "a word's start, never kostet");
  assert.deepEqual(await matching("Rau"), []);
  assert.deepEqual(await matching("sus"), []);
  assert.deepEqual(await matching("Rente"), ["Studienrente kommt"]);
  assert.deepEqual(await matching("Wahl"), ["Auswahl der Woche", "Die Wahl ist vorbei", "Landtagswahlen 2026", "Wahlkampf in Bayern"]);
  assert.deepEqual(await matching("Wahlen"), ["Auswahl der Woche", "Die Wahl ist vorbei", "Landtagswahlen 2026", "Wahlkampf in Bayern"]);
  assert.deepEqual(await matching("Deutsche Bahn"), ["Deutschen Bahn streikt"]);
  assert.deepEqual(await matching("Straubing"), ["Eishockey: Straubing gewinnt", "Frau in Straubing"]);
});

test("regional: a quiet state is empty with the German sentence; Frankfurt is ambiguous and nothing is requested", async () => {
  const mock = tagesschauApi();
  const bremen = await getRegionalNews(client(mock), { states: ["Bremen"] });
  assert.equal(bremen.status, "empty");
  assert.match(bremen.status === "empty" ? (bremen.reason ?? "") : "", /Aktuell keine regionalen Meldungen für Bremen\./);
  const before = mock.calls.length;
  const frankfurt = await getRegionalNews(client(mock), { states: ["Bayern", "Frankfurt"] });
  assert.ok(frankfurt.status === "ambiguous");
  assert.deepEqual(frankfurt.candidates, [{ id: "7", name: "Hessen" }, { id: "4", name: "Brandenburg" }]);
  assert.equal(mock.calls.length, before);
});

test("regional: an unknown state names the states; more than four states or none is refused; all before any request", async () => {
  const mock = tagesschauApi();
  await assert.rejects(getRegionalNews(client(mock), { states: ["Atlantis"] }), /No Bundesland is named "Atlantis".*Bayern \(2\)/);
  await assert.rejects(getRegionalNews(client(mock), { states: ["1", "2", "3", "4", "5"] }), /At most 4 states/);
  await assert.rejects(getRegionalNews(client(mock), { states: [] }), /at least one Bundesland/);
  await assert.rejects(getRegionalNews(client(mock), { states: [" "] }), TagesschauValidationError);
  assert.equal(mock.calls.length, 0);
});

// ---- getTopicCoverage --------------------------------------------------------------------------

test("coverage: the total leads; page 1 is resultPage 0; stories and videos apart, newest first; a timeline by Berlin days", async () => {
  const mock = tagesschauApi();
  const c = await getTopicCoverage(client(mock), { query: "Bundestag", pageSize: 10, now: NOW });
  assert.deepEqual(requests(mock), ["/api2u/search/?searchText=Bundestag&pageSize=10&resultPage=0"]);
  assert.equal(c.status, "ok");
  assert.deepEqual([c.total, c.page, c.pages, c.nextPage], [109, 1, 11, 2]);
  assert.deepEqual([c.stories.length, c.videos.length], [4, 6]);
  assert.ok(c.videos.every((v) => v.shareURL === null && v.stream?.endsWith(".m3u8")));
  assert.equal(c.stories[0]?.sophoraId, "swr-kita-gesetz-des-bundes-oezdemir-kuendigt-widerstand-an-kommunen-erleichtert-100");
  assert.deepEqual(c.timeline, { today: 0, lastSevenDays: 10, older: 0, newest: "2026-11-18T18:42:41.574+01:00", oldest: "2026-11-13T14:11:16.376+01:00" });
  assert.match(c.verdict, /^109 hits for "Bundestag"; page 1 of 11 \(10 per page\): 4 articles, 6 videos$/);
});

test("coverage: near-identical hits (one title the same day) are listed once and counted", async () => {
  const search = [...SEARCH_RESULTS, variant(SEARCH_RESULTS[0], { sophoraId: "video-1686003" }), variant(SEARCH_RESULTS[4], {})];
  const c = await getTopicCoverage(client(tagesschauApi({ search })), { query: "Bundestag", pageSize: 25, now: NOW });
  assert.equal(c.duplicatesDropped, 2);
  assert.deepEqual([c.stories.length, c.videos.length], [4, 6]);
});

test("coverage: an empty page inside the count says the two disagree, with no nextPage; an answer without a total says it has none", async () => {
  // The recording has 109 hits but no hits on page 2: "past the last page (11 pages)" contradicted itself.
  const mock = tagesschauApi();
  const inside = await getTopicCoverage(client(mock), { query: "Bundestag", pageSize: 10, page: 2 });
  assert.equal(inside.status, "empty");
  assert.match(inside.reason ?? "", /Page 2 came back without hits, though the search counts 109 hits \(11 pages of 10\)/);
  assert.doesNotMatch(inside.reason ?? "", /past the last page/);
  assert.equal(inside.nextPage, undefined, "no next page after an empty one");
  // Without totalItemCount, an empty page 3 is no "No Tagesschau coverage", and a full page says total is the page's.
  const noTotal = makeMockTransport((request) => {
    const page = Number(new URL(request.url).searchParams.get("resultPage"));
    return jsonResponse({ searchText: "Merz", searchResults: page === 0 ? SEARCH_RESULTS.slice(0, 3) : [] });
  });
  const later = await getTopicCoverage(new TagesschauClient({ transport: noTotal.transport }), { query: "Merz", page: 3 });
  assert.equal(later.status, "empty");
  assert.match(later.reason ?? "", /Page 3 has no hits, and the API's answer gave no total hit count/);
  assert.doesNotMatch(later.reason ?? "", /No Tagesschau coverage/);
  const first = await getTopicCoverage(new TagesschauClient({ transport: noTotal.transport }), { query: "Merz" });
  assert.match((first.notes ?? []).join(" "), /gave no total hit count: total counts this page's hits only/);
});

test("coverage: a page past the last says how many there are; no hits is empty with a broader word; ASCII umlauts get a note", async () => {
  const mock = tagesschauApi();
  const past = await getTopicCoverage(client(mock), { query: "Bundestag", pageSize: 10, page: 12 });
  assert.equal(past.status, "empty");
  assert.match(past.reason ?? "", /Page 12 is past the last page \(11 pages of 10 for 109 hits\)/);
  assert.equal(new URL(mock.calls.at(-1)?.url ?? "").searchParams.get("resultPage"), "11");
  const none = await getTopicCoverage(client(mock), { query: "Strasse" });
  assert.equal(none.status, "empty");
  assert.match(none.reason ?? "", /0 hits.*broader word.*ä, ö, ü or ß/);
  assert.match(none.spellingNote ?? "", /Strasse/);
  await assert.rejects(getTopicCoverage(client(mock), { query: "  " }), /search text must not be empty/);
  await assert.rejects(getTopicCoverage(client(mock), { query: "x", page: 0 }), /page must be an integer from 1/);
  assert.equal(mock.calls.length, 2);
});

// ---- getLiveStreams ---------------------------------------------------------------------------

test("live streams: the livestream first with its HLS link and no date; editions; the accessible ones last; repeated titles kept", async () => {
  const s = await getLiveStreams(client(tagesschauApi()));
  assert.equal(s.status, "ok");
  assert.equal(s.channels.length, 8);
  assert.deepEqual(s.channels.map((c) => c.kind), ["live", "edition", "edition", "edition", "edition", "edition", "accessible", "accessible"]);
  assert.equal(s.channels[0]?.hls, "https://tagesschau-live.ard-mcdn.de/tagesschau/live/hls/de/master.m3u8");
  assert.equal(s.channels[0]?.date, undefined);
  assert.equal(s.channels.filter((c) => c.title === "tagesschau").length, 2);
  assert.match(s.notes.join(" "), /"tagesschau": different editions, told apart by date/);
  assert.ok(Object.keys(s.channels[1]?.streams ?? {}).length > 1, "every protocol, not one flat link");
});

test("live streams: tagesschau24 or the livestream asked by name finds the livestream while it carries another show's title", async () => {
  // Live on 2026-11-23 at 07:43 CET: the livestream ran as "Im Livestream: morgenmagazin", same HLS link.
  const channels = CHANNELS.map((c, i) => (i === 0 ? variant(c, { title: "Im Livestream: morgenmagazin" }) : c));
  const mock = tagesschauApi({ channels });
  for (const show of ["tagesschau24", "tagesschau 24", "tagesschau24 live", "Livestream", "live"]) {
    const s = await getLiveStreams(client(mock), { show });
    assert.equal(s.status, "ok", show);
    assert.deepEqual(s.channels.map((c) => [c.title, c.kind]), [["Im Livestream: morgenmagazin", "live"]], show);
    assert.match(s.notes.join(" "), /livestream is tagesschau24's.*names the programme running now/, show);
  }
  assert.deepEqual((await getLiveStreams(client(mock), { show: "morgenmagazin" })).channels.map((c) => c.kind), ["live"]);
  assert.equal((await getLiveStreams(client(mock), { show: "tagesthemen" })).channels.length, 1, "another show is no livestream");
});

test("live streams: a show narrows by title; one not offered is empty naming those there are; a channel without streams is unavailable", async () => {
  const channels = [...CHANNELS, { sophoraId: "x-1", title: "tagesschau extra", date: "2026-11-19T22:00:00.000+01:00", type: "video" }];
  const mock = tagesschauApi({ channels });
  const sign = await getLiveStreams(client(mock), { show: "Gebärdensprache" });
  assert.deepEqual(sign.channels.map((c) => c.title), ["tagesschau mit Gebärdensprache"]);
  // The title says "in Einfacher Sprache"; a user types the name as "Einfache Sprache".
  for (const show of ["Einfache Sprache", "tagesschau in Einfache Sprache", "einfacher sprache"]) {
    assert.deepEqual((await getLiveStreams(client(mock), { show })).channels.map((c) => c.title), ["tagesschau in Einfacher Sprache"], show);
  }
  const extra = await getLiveStreams(client(mock), { show: "extra" });
  assert.deepEqual([extra.channels[0]?.available, extra.channels[0]?.hls], [false, undefined]);
  assert.match(extra.verdict, /1 without a stream right now/);
  const missing = await getLiveStreams(client(mock), { show: "Sportschau" });
  assert.equal(missing.status, "empty");
  assert.match(missing.reason ?? "", /No channel's title contains "Sportschau"\. The channels offered: Im Livestream: tagesschau24; /);
});

// ---- getNewsFeed ---------------------------------------------------------------------------

test("news feed: a state by name with its cursor; the cursor gives the older page; ressort and state together are refused", async () => {
  const mock = tagesschauApi();
  const berlin = await getNewsFeed(client(mock), { state: "berlin" });
  assert.ok(berlin.status === "ok");
  assert.deepEqual([berlin.items.length, berlin.nextDate, berlin.filter], [10, "261112", { state: "Berlin", region: "3" }]);
  const older = await getNewsFeed(client(mock), { state: "Berlin", date: berlin.nextDate });
  assert.equal(older.status, "empty");
  assert.deepEqual(requests(mock), ["/api2u/news/?regions=3", "/api2u/news/?date=261112&regions=3"]);
  await assert.rejects(getNewsFeed(client(mock), { ressort: "sport", state: "Bayern" }), /a ressort or a state, not both/);
  await assert.rejects(getNewsFeed(client(mock), { date: "20261112" }), /Invalid date/);
  const frankfurt = await getNewsFeed(client(mock), { state: "Frankfurt" });
  assert.equal(frankfurt.status, "ambiguous");
  assert.equal(mock.calls.length, 2);
});

test("news feed: a Ressort's items in the feed's order, each once", async () => {
  const feed = await getNewsFeed(client(tagesschauApi()), { ressort: "sport" });
  assert.ok(feed.status === "ok");
  assert.equal(feed.repeatsDropped, 2);
  assert.deepEqual(feed.items.slice(0, 2).map((h) => h.sophoraId), ["alcaraz-atp-finals-neuer-stil-100", "smits-comeback-handball-em-frauen-100"]);
});

// ---- getArticle ---------------------------------------------------------------------------

test("article: its text block by block, HTML dropped; a box and a related item with their ids; media counted", async () => {
  const mock = tagesschauApi();
  const a = await getArticle(client(mock), { article: "https://www.tagesschau.de/api2u/inland/innenpolitik/gipfel-koalition-willige-ukraine-100.json" });
  assert.ok(a.status === "ok");
  assert.deepEqual(requests(mock), ["/api2u/inland/innenpolitik/gipfel-koalition-willige-ukraine-100.json"]);
  assert.equal(a.title, "Merz will baldige Russland-Gespräche auf neutralem Boden");
  assert.match(a.blocks[0]?.text ?? "", /^Die "Koalition der Willigen" verspricht/);
  assert.ok(!a.blocks.some((b) => /<[a-z]/.test(b.text)), "no HTML left");
  assert.deepEqual(a.blocks[4], { type: "headline", text: "Gespräche auf neutralem Boden" });
  const box = a.blocks.find((b) => b.type === "box");
  assert.equal(box?.articleId, "ausland/asien/dreiergipfel-xi-trump-putin-100");
  assert.ok(a.blocks.some((b) => b.type === "related" && b.articleId !== undefined));
  assert.ok(a.blocks.some((b) => b.type === "quotation"));
  assert.deepEqual(a.media, { video: 1 });
});

test("article: an id the API no longer has is empty with the reason; a bad id is refused before any request", async () => {
  const mock = tagesschauApi();
  const gone = await getArticle(client(mock), { article: "inland/gibt-es-nicht-100" });
  assert.equal(gone.status, "empty");
  assert.match(gone.status === "empty" ? gone.reason : "", /No item under "inland\/gibt-es-nicht-100" \(HTTP 404\).*Depublizierung/);
  for (const bad of ["../etc/passwd", "inland/../x", "https://evil.example/api2u/x.json", "https://www.tagesschau.de/api2u/x.json?y=1", "Inland/X", "inland/x%2e"]) {
    await assert.rejects(getArticle(client(mock), { article: bad }), TagesschauValidationError, bad);
  }
  assert.equal(mock.calls.length, 1);
});

test("article: an item without text (a podcast webview) is empty, saying so and naming its link; one with only a video too", async () => {
  // Live on 2026-11-23: the 11KM podcast's details answer has no content at all.
  const podcast = { sophoraId: "podcast-11km-aufruestung-weltall-100", title: "Werden Kriege zukünftig im Weltall entschieden?", type: "webview", date: "2026-11-23T03:00:00.000+01:00", shareURL: "https://www.tagesschau.de/multimedia/podcast/11km/podcast-11km-aufruestung-weltall-100.html" };
  const onlyVideo = variant(ARTICLE, { content: [{ type: "video", video: { title: "x" } }] });
  const mock = tagesschauApi({ articles: { "multimedia/podcast/11km/podcast-11km-aufruestung-weltall-100": podcast, "inland/nur-video-100": onlyVideo } });
  const a = await getArticle(client(mock), { article: "/api2u/multimedia/podcast/11km/podcast-11km-aufruestung-weltall-100.json" });
  assert.ok(a.status === "empty");
  assert.match(a.reason, /has no text in the API \(type webview\).*shareURL/);
  assert.deepEqual([a.title, a.type, a.shareURL], [podcast.title, "webview", podcast.shareURL]);
  const v = await getArticle(client(mock), { article: "inland/nur-video-100" });
  assert.ok(v.status === "empty");
  assert.match(v.reason, /no text in the API.*only embedded media \(video 1\)/);
  assert.deepEqual(v.media, { video: 1 });
});

test("article: an answer with a blank title is a parse error naming the shape, not a TypeError", async () => {
  const mock = tagesschauApi({ articles: { "inland/leer-100": variant(ARTICLE, { title: "   " }) } });
  await assert.rejects(getArticle(client(mock), { article: "inland/leer-100" }), (err: unknown) => err instanceof TagesschauParseError && /inland\/leer-100.*no title/.test(err.message));
});

test("shape drift: items that all lack a title are a parse error in every feed tool, never 'no news'; some without one are a note", async () => {
  // A renamed field (headline for title) made every feed tool say "nothing to report right now".
  const renamed = (items: readonly JsonObject[]): JsonObject[] => items.map(({ title, ...rest }) => ({ ...rest, headline: title ?? null }));
  const mock = tagesschauApi({ homepage: renamed(HOMEPAGE_NEWS), ressorts: { inland: renamed(HOMEPAGE_NEWS) }, regions: { "13": renamed(HOMEPAGE_NEWS) }, search: renamed(SEARCH_RESULTS), channels: renamed(CHANNELS) });
  const drift = (err: unknown): boolean => err instanceof TagesschauParseError && /none with a title: the answer's shape has changed/.test(err.message);
  await assert.rejects(getBriefing(client(mock), {}), drift);
  await assert.rejects(getBriefing(client(mock), { ressorts: ["inland"] }), drift);
  await assert.rejects(getRegionalNews(client(mock), { states: ["Sachsen"] }), drift);
  await assert.rejects(getNewsFeed(client(mock), {}), drift);
  await assert.rejects(getTopicCoverage(client(mock), { query: "Bundestag", pageSize: 10 }), drift);
  await assert.rejects(getLiveStreams(client(mock), {}), drift);
  // Two of the homepage's items without a title: the rest is listed, and a note counts them.
  const some = tagesschauApi({ homepage: HOMEPAGE_NEWS.map((item, i) => (i < 2 ? variant(item, { title: " " }) : item)) });
  const b = await getBriefing(client(some), {});
  assert.equal(b.topStories.length, HOMEPAGE_NEWS.length - 2);
  assert.match(b.notes.join(" "), /2 items without a title left out \(homepage\)/);
});

// ---- helpers ---------------------------------------------------------------------------

test("plainText drops tags, decodes entities, keeps list items and line breaks", () => {
  assert.equal(plainText("<strong>A &amp; B</strong> &quot;C&quot;&nbsp;D &#8211; E"), 'A & B "C" D – E');
  assert.equal(plainText("<ul><li>eins</li><li>zwei</li></ul>"), "• eins\n• zwei");
  assert.equal(plainText("a<br/>b <a href=\"x\">link</a>"), "a\nb link");
  assert.equal(plainText("&bogus; &#0;"), "&bogus; &#0;");
});

test("plainText takes linear time on text with many '<' and no '>'", () => {
  // Each regular expression tried at every "<" and ran to the end: 80 000 "<" took 11 s.
  for (const hostile of ["<".repeat(400_000), "<li".repeat(150_000), "<br".repeat(150_000), "a<b".repeat(150_000), '<a title="'.repeat(50_000)]) {
    const started = performance.now();
    plainText(hostile);
    assert.ok(performance.now() - started < 1000, `${hostile.slice(0, 10)}… took ${Math.round(performance.now() - started)} ms`);
  }
});

test("plainText: a bare '<' is text, a '>' inside a quoted attribute stays in the tag, <link> is no list item", () => {
  assert.equal(plainText("3 < 5 und 7 > 4"), "3 < 5 und 7 > 4");
  assert.equal(plainText('<a href="x" title="a > b">Link</a> danach'), "Link danach");
  assert.equal(plainText("<link rel=x>Text"), "Text");
  assert.equal(plainText("a <b"), "a <b", "a tag never closed is text");
});

test("plainText decodes the named entities of German text: quotes, dashes, ellipsis, euro, umlauts; a soft hyphen goes", () => {
  assert.equal(plainText("&bdquo;Ja&ldquo; &ndash; 5&nbsp;&euro; &hellip; Stra&szlig;e &Auml;rger &auml;h Ge&shy;setz &raquo;x&laquo; 3&deg;"), "„Ja“ – 5 € … Straße Ärger äh Gesetz »x« 3°");
  assert.equal(plainText("&AMP; &Bogus;"), "& &Bogus;");
});

test("the broadcaster comes from the shareURL host; fold spells umlauts out", () => {
  assert.deepEqual(["https://www1.wdr.de/x", "https://www.butenunbinnen.de/y", "https://example.org/", "not a url", null].map((u) => broadcasterOf(u)), ["WDR", "Radio Bremen", undefined, undefined, undefined]);
  assert.equal(fold("Thüringen-Süd Straße"), "thueringensuedstrasse");
});
