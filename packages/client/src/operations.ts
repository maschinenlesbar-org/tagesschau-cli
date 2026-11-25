// The use cases of the skills as library functions, built on the client's calls: each carries the
// traps the skills document, so no caller (the MCP server's use-case tools, a library user) has to
// know them:
// - getBriefing (tagesschau-briefing): the homepage's editorial order, breaking news first, Ressort
//   feeds sorted by date, repeats and stories already on the homepage dropped, sport filed as sport;
// - getRegionalNews (tagesschau-regional): a Bundesland by name, code or city to its region id, one
//   request per state (several share one page), Berlin/Brandenburg as a pair, a topic filtered here
//   (the API ignores the region when a Ressort is sent);
// - getTopicCoverage (tagesschau-topic-tracker): the total hit count, a 1-based page, stories and
//   videos apart, newest first, near-identical hits once, a timeline of the page;
// - getLiveStreams (tagesschau-watch-live): the channels with their playable HLS link;
// - getNewsFeed and getArticle: the news feed with its page cursor, and one item's text.
// Ambiguity is reported, never guessed; an empty answer says what was asked and what to change.
// The call's cancellation reaches every request through the transport.

import { newsDateProblem, type TagesschauClient } from "./client.js";
import { TagesschauApiError, TagesschauParseError, TagesschauValidationError, quoteValue } from "./errors.js";
import type { Region, Ressort } from "./enums.js";
import type { JsonObject, JsonValue, NewsItem } from "./types.js";
import { articleIdOf, articleIdProblem, ressortProblem, searchSpellingHint, searchTextProblem, textProblem } from "./validate.js";

// ---- shared ----------------------------------------------------------------------------

/** One news item as the use cases give it: the fields a reader needs, nothing nested. */
export interface Headline {
  sophoraId: string;
  title: string;
  /** The kicker above the headline (`Spritpreise`). */
  topline?: string;
  /** The teaser sentence (given for lead items; missing on most NDR and MDR items). */
  firstSentence?: string;
  /** ISO 8601 with offset, as the API gives it. */
  date?: string;
  /** The item's own Ressort; absent when the API gives none (regional, sport, many search hits). */
  ressort?: string;
  /** What a briefing groups it under: the Ressort asked for, its own, else "video" or "weitere". */
  group?: string;
  /** story, video, webview, … */
  type?: string;
  /** Eilmeldung. */
  breakingNews?: true;
  /** The public article page; null for video items. */
  shareURL: string | null;
  /** For getArticle: the item's `details` path under /api2u/ (absent for video items). */
  articleId?: string;
  /** The Bundesländer a regional item is tagged with, by name. */
  regions?: string[];
  /** The ARD broadcaster of a regional item, from its shareURL host. */
  broadcaster?: string;
  tags?: string[];
  /** A video's HLS stream (playable in VLC, mpv, Safari). */
  stream?: string;
}

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

/** A non-empty string field of `item`, trimmed; else undefined. */
function text(item: JsonObject, key: string): string | undefined {
  const value = item[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** The ARD broadcasters by the host of a regional item's shareURL (the skill's table). */
const BROADCASTERS: readonly [RegExp, string][] = [
  [/(^|\.)swr\.de$/, "SWR"],
  [/(^|\.)br\.de$/, "BR"],
  [/(^|\.)rbb24\.de$/, "rbb"],
  [/(^|\.)butenunbinnen\.de$/, "Radio Bremen"],
  [/(^|\.)ndr\.de$/, "NDR"],
  [/(^|\.)hessenschau\.de$/, "hr"],
  [/(^|\.)wdr\.de$/, "WDR"],
  [/(^|\.)sr\.de$/, "SR"],
  [/(^|\.)mdr\.de$/, "MDR"],
  [/(^|\.)tagesschau\.de$/, "ARD-aktuell"],
  [/(^|\.)sportschau\.de$/, "Sportschau"],
];

/** The broadcaster of `shareURL`, by its host; undefined without one or for an unknown host. */
export function broadcasterOf(shareURL: string | null | undefined): string | undefined {
  if (typeof shareURL !== "string") return undefined;
  let host: string;
  try {
    host = new URL(shareURL).hostname;
  } catch {
    return undefined;
  }
  return BROADCASTERS.find(([pattern]) => pattern.test(host))?.[1];
}

/** `item` as a Headline, or undefined when it has no title (nothing to show). */
export function headlineOf(item: NewsItem, options: { group?: string; teaser?: boolean } = {}): Headline | undefined {
  if (!isObject(item)) return undefined;
  const title = text(item, "title");
  if (title === undefined) return undefined;
  const shareURL = text(item, "shareURL") ?? null;
  const details = text(item, "details");
  const articleId = details === undefined ? undefined : articleIdOf(details);
  const regionIds = Array.isArray(item["regionIds"]) ? item["regionIds"] : typeof item["regionId"] === "number" ? [item["regionId"]] : [];
  const regions = regionIds.flatMap((id) => {
    const state = STATES.find((s) => s.id === String(id));
    return state === undefined ? [] : [state.name];
  });
  const tags = Array.isArray(item["tags"]) ? item["tags"].flatMap((t) => (isObject(t) && typeof t["tag"] === "string" && t["tag"].trim() !== "" ? [t["tag"].trim()] : [])) : [];
  const streams = isObject(item["streams"]) ? item["streams"] : undefined;
  const stream = streams === undefined ? undefined : text(streams, "adaptivestreaming");
  const topline = text(item, "topline");
  const firstSentence = options.teaser === false ? undefined : text(item, "firstSentence");
  const date = text(item, "date");
  const ressort = text(item, "ressort");
  const type = text(item, "type");
  const broadcaster = regions.length > 0 ? broadcasterOf(shareURL) : undefined;
  return {
    sophoraId: text(item, "sophoraId") ?? "",
    title,
    ...(topline === undefined ? {} : { topline }),
    ...(firstSentence === undefined ? {} : { firstSentence }),
    ...(date === undefined ? {} : { date }),
    ...(ressort === undefined ? {} : { ressort }),
    ...(options.group === undefined ? {} : { group: options.group }),
    ...(type === undefined ? {} : { type }),
    ...(item["breakingNews"] === true ? { breakingNews: true as const } : {}),
    shareURL,
    ...(articleId === undefined ? {} : { articleId }),
    ...(regions.length > 0 ? { regions } : {}),
    ...(broadcaster === undefined ? {} : { broadcaster }),
    ...(tags.length > 0 ? { tags } : {}),
    ...(stream === undefined ? {} : { stream }),
  };
}

/** The key two copies of one item share: the sophoraId, else the shareURL, else the title. */
function keyOf(h: Headline): string {
  return h.sophoraId !== "" ? `id:${h.sophoraId}` : h.shareURL !== null ? `url:${h.shareURL}` : `title:${fold(h.title)}`;
}

/** The time of an ISO date, or -Infinity without one (sorted last). */
function timeOf(h: Headline): number {
  const t = h.date === undefined ? Number.NaN : Date.parse(h.date);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** Newest first; items without a date last, in their order. */
function newestFirst(items: readonly Headline[]): Headline[] {
  return items.map((h, i) => ({ h, i })).sort((a, b) => timeOf(b.h) - timeOf(a.h) || a.i - b.i).map(({ h }) => h);
}

/** `items` with each item once (the first copy kept), and how many copies were dropped. */
function dedup(items: readonly Headline[], seen = new Set<string>()): { items: Headline[]; dropped: number } {
  const out: Headline[] = [];
  let dropped = 0;
  for (const h of items) {
    const key = keyOf(h);
    if (seen.has(key)) {
      dropped++;
      continue;
    }
    seen.add(key);
    out.push(h);
  }
  return { items: out, dropped };
}

/** Lowercase, umlauts and ß spelled out (ä -> ae), other accents dropped; other characters kept. */
function spelled(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Lowercase, umlauts and ß spelled out (ä -> ae), other accents dropped, only letters and digits kept. */
export function fold(value: string): string {
  return spelled(value).replace(/[^a-z0-9]+/g, "");
}

/** The words of `value`, each spelled as `fold` does, in their order. */
function wordsOf(value: string): string[] {
  return spelled(value).split(/[^a-z0-9]+/).filter((w) => w !== "");
}

/** `word` without one German inflection ending (Wahlen -> wahl, einfacher -> einfach) when 4 letters stay. */
function stem(word: string): string {
  const bare = word.replace(/(?:en|er|es|em|e|n)$/, "");
  return bare.length >= 4 ? bare : word;
}

/**
 * True when `field` mentions the words of `topic`, in their order, each as a word of its own: a
 * topic word matches a field word that starts with it (Eis: Eishockey), with an inflection ending
 * left aside (Wahlen: Wahlkampf), or, from 4 letters, the end of a compound (Wahl: Landtagswahl).
 * Never inside a word (Eis isn't in Preise or Bahnreisende) or across two (sus isn't in "Kreis
 * Usedom"): a short word inside others matched most items of a feed.
 */
export function mentionsWords(field: string, topic: string): boolean {
  const want = wordsOf(topic).map(stem);
  if (want.length === 0) return false;
  const words = wordsOf(field);
  const matches = (word: string, t: string): boolean => word.startsWith(t) || (t.length >= 4 && (word.endsWith(t) || stem(word).endsWith(t)));
  for (let i = 0; i + want.length <= words.length; i++) {
    if (want.every((t, j) => matches(words[i + j] as string, t))) return true;
  }
  return false;
}

/** `value` as a 1-based count within `min`..`max`, else the default; a non-integer is refused. */
function countOf(name: string, value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TagesschauValidationError(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

/** The free text `value` checked (`textProblem`) and trimmed, or a TagesschauValidationError naming `name`. */
function freeText(name: string, value: string, max: number): string {
  const problem = textProblem(value);
  if (problem !== undefined) throw new TagesschauValidationError(`${name}: ${problem}`);
  const trimmed = value.normalize("NFC").trim();
  if (trimmed.length > max) throw new TagesschauValidationError(`${name} is longer than ${max} characters.`);
  return trimmed;
}

// ---- Bundesländer ------------------------------------------------------------------------

/** A Bundesland: its region id, name, codes and the other names the skill maps to it. */
export interface State {
  id: Region;
  name: string;
  /** Other names: codes, English names, the capital and big cities. */
  aliases: readonly string[];
}

/**
 * The 16 Bundesländer, ids alphabetical as the API documents them (the regional skill's table).
 * A city's written forms resolve like its name (Frankfurt (Oder), Halle (Saale)); the bare
 * "Halle" is the city on the Saale, and Halle (Westf.) is named as such.
 */
export const STATES: readonly State[] = [
  { id: "1", name: "Baden-Württemberg", aliases: ["BW", "Ländle", "Stuttgart", "Karlsruhe", "Mannheim", "Freiburg"] },
  { id: "2", name: "Bayern", aliases: ["BY", "Bavaria", "München", "Munich", "Nürnberg", "Augsburg"] },
  { id: "3", name: "Berlin", aliases: ["BE"] },
  { id: "4", name: "Brandenburg", aliases: ["BB", "Potsdam", "Cottbus", "Frankfurt (Oder)", "Frankfurt/Oder", "Frankfurt an der Oder"] },
  { id: "5", name: "Bremen", aliases: ["HB", "Bremerhaven"] },
  { id: "6", name: "Hamburg", aliases: ["HH"] },
  { id: "7", name: "Hessen", aliases: ["HE", "Hesse", "Wiesbaden", "Frankfurt am Main", "Frankfurt/Main", "Frankfurt a. M.", "Kassel"] },
  { id: "8", name: "Mecklenburg-Vorpommern", aliases: ["MV", "Meck-Pomm", "Mecklenburg-Western Pomerania", "Schwerin", "Rostock"] },
  { id: "9", name: "Niedersachsen", aliases: ["NI", "NDS", "Lower Saxony", "Hannover", "Hanover", "Braunschweig", "Osnabrück"] },
  { id: "10", name: "Nordrhein-Westfalen", aliases: ["NRW", "NW", "North Rhine-Westphalia", "Köln", "Cologne", "Düsseldorf", "Ruhrgebiet", "Dortmund", "Essen", "Bonn", "Halle (Westf.)", "Halle (Westfalen)"] },
  { id: "11", name: "Rheinland-Pfalz", aliases: ["RP", "RLP", "Rhineland-Palatinate", "Mainz", "Koblenz", "Trier"] },
  { id: "12", name: "Saarland", aliases: ["SL", "Saarbrücken"] },
  { id: "13", name: "Sachsen", aliases: ["SN", "Saxony", "Dresden", "Leipzig", "Chemnitz"] },
  { id: "14", name: "Sachsen-Anhalt", aliases: ["ST", "LSA", "Saxony-Anhalt", "Magdeburg", "Halle", "Halle (Saale)", "Halle an der Saale"] },
  { id: "15", name: "Schleswig-Holstein", aliases: ["SH", "Kiel", "Lübeck", "Flensburg"] },
  { id: "16", name: "Thüringen", aliases: ["TH", "Thuringia", "Erfurt", "Jena", "Gera"] },
];

/** Names that stand for places in two states: never picked, always asked. */
const AMBIGUOUS_NAMES: ReadonlyMap<string, { states: readonly Region[]; why: string }> = new Map([
  ["frankfurt", { states: ["7", "4"], why: "Frankfurt am Main is in Hessen, Frankfurt (Oder) in Brandenburg" }],
]);

/** The answer of {@link resolveState}. */
export type StateLookup =
  | { status: "ok"; state: State }
  | { status: "ambiguous"; query: string; why: string; candidates: { id: Region; name: string }[] }
  | { status: "unknown"; query: string };

/** The fold of every name of every state, a folded name with umlauts as plain vowels too ("thuringen"). */
const STATE_KEYS: ReadonlyMap<string, State> = new Map(
  STATES.flatMap((state) =>
    [state.name, ...state.aliases].flatMap((name) => {
      const plain = name.normalize("NFD").replace(/\p{M}/gu, "");
      return [[fold(name), state] as const, [fold(plain), state] as const];
    }),
  ),
);

/**
 * The Bundesland `query` names: a region id 1..16, a name (case, umlauts written ae/oe/ue or
 * plain, hyphens and spaces aside), a code (BY, NRW), an English name or a city of the skill's
 * table. "Frankfurt" alone is `ambiguous` (am Main or Oder); anything else `unknown`.
 */
export function resolveState(query: string): StateLookup {
  const trimmed = query.trim();
  const byId = STATES.find((s) => s.id === trimmed);
  if (byId !== undefined) return { status: "ok", state: byId };
  const key = fold(trimmed);
  const ambiguous = AMBIGUOUS_NAMES.get(key);
  if (ambiguous !== undefined) {
    return {
      status: "ambiguous",
      query: trimmed,
      why: ambiguous.why,
      candidates: ambiguous.states.map((id) => ({ id, name: (STATES.find((s) => s.id === id) as State).name })),
    };
  }
  const state = STATE_KEYS.get(key);
  return state === undefined ? { status: "unknown", query: trimmed } : { status: "ok", state };
}

/** A TagesschauValidationError for a name no state has, listing the states. */
function unknownState(query: string): TagesschauValidationError {
  return new TagesschauValidationError(
    `No Bundesland is named ${quoteValue(query)}. Give a state's name, code or region id: ${STATES.map((s) => `${s.name} (${s.id})`).join(", ")}; or a big city (München, Köln, Leipzig).`,
  );
}

// ---- getBriefing ---------------------------------------------------------------------------

/** At most this many Ressort feeds per briefing (each is one request of the API's 60 an hour). */
export const MAX_BRIEFING_RESSORTS = 3;

/** The input of {@link getBriefing}. */
export interface BriefingInput {
  /** Ressort feeds to add (up to 3): inland, ausland, wirtschaft, sport, video, investigativ, wissen. */
  ressorts?: readonly string[] | undefined;
  /** The homepage's top stories: default true without ressorts, false with them. */
  topStories?: boolean | undefined;
  /** At most this many items per Ressort feed, newest first (1–30, default 10). */
  perRessort?: number | undefined;
}

/** One Ressort feed of a briefing, counted. */
export interface RessortCount {
  ressort: Ressort;
  /** Items in the feed as the API sent them. */
  items: number;
  /** Copies of one item in the feed itself, dropped (the sport feed repeats items). */
  repeatsDropped: number;
  /** Items already among the top stories or an earlier feed, dropped. */
  alreadyListed: number;
  /** Different items left, listed or not. */
  unique: number;
  shown: number;
  more: number;
}

/** The answer of {@link getBriefing}. */
export interface Briefing {
  status: "ok" | "empty";
  reason?: string;
  verdict: string;
  /** Eilmeldungen from every feed read, first. */
  breaking: Headline[];
  /** The homepage's top stories in its editorial order (not re-sorted). */
  topStories: Headline[];
  /** The Ressort feeds' items, newest first per feed, each grouped under its feed's Ressort. */
  ressortStories: Headline[];
  ressorts: RessortCount[];
  /** The homepage's regional block, left out of a national briefing (getRegionalNews has it). */
  regionalLeftOut?: number;
  notes: string[];
}

/**
 * A briefing of the current news: the homepage's top stories in its editorial order (when asked
 * or when no Ressort is given) and up to three Ressort feeds, each sorted newest first (the feeds
 * are not in date order: sport opened with a two-day-old item) and cut to `perRessort`. Breaking
 * news (`breakingNews`) from any feed leads. Every item is listed once: copies inside a feed (the
 * sport feed repeats items) and stories already listed are dropped and counted. An item of a
 * Ressort feed is grouped under that Ressort even when its own `ressort` is missing (every sport
 * item); a top story without one under "video" or "weitere", never a guessed topic.
 */
export async function getBriefing(client: TagesschauClient, input: BriefingInput = {}): Promise<Briefing> {
  const asked = input.ressorts ?? [];
  if (!Array.isArray(asked)) throw new TagesschauValidationError("ressorts must be an array of Ressort names.");
  const ressorts: Ressort[] = [];
  for (const value of asked) {
    const name = typeof value === "string" ? value.trim().toLowerCase() : value;
    const problem = ressortProblem(name);
    if (problem !== undefined) throw new TagesschauValidationError(problem);
    if (!ressorts.includes(name as Ressort)) ressorts.push(name as Ressort);
  }
  if (ressorts.length > MAX_BRIEFING_RESSORTS) {
    throw new TagesschauValidationError(`At most ${MAX_BRIEFING_RESSORTS} Ressorts per briefing (each is one request; the API allows 60 an hour).`);
  }
  const perRessort = countOf("perRessort", input.perRessort, 1, 30, 10);
  const withTop = ressorts.length === 0 ? true : input.topStories === true;
  const seen = new Set<string>();
  const breaking: Headline[] = [];
  const topStories: Headline[] = [];
  const ressortStories: Headline[] = [];
  const counts: RessortCount[] = [];
  const notes: string[] = [];
  let regionalLeftOut: number | undefined;
  if (withTop) {
    const home = await client.homepage();
    const items = home.news.flatMap((item) => {
      const h = headlineOf(item);
      if (h === undefined) return [];
      return [{ ...h, group: h.ressort ?? (h.type === "video" ? "video" : "weitere") }];
    });
    for (const h of dedup(items, seen).items) (h.breakingNews ? breaking : topStories).push(h);
    regionalLeftOut = home.regional.length;
  }
  for (const ressort of ressorts) {
    const feed = await client.news({ ressort });
    const items = feed.news.flatMap((item) => {
      const h = headlineOf(item, { group: ressort });
      return h === undefined ? [] : [h];
    });
    const own = dedup(items);
    const fresh = dedup(own.items, seen);
    const sorted = newestFirst(fresh.items);
    const lead = sorted.filter((h) => h.breakingNews);
    breaking.push(...lead);
    const rest = sorted.filter((h) => !h.breakingNews).map(({ firstSentence: _teaser, ...h }) => h);
    const shown = rest.slice(0, perRessort);
    ressortStories.push(...shown);
    counts.push({
      ressort,
      items: feed.news.length,
      repeatsDropped: own.dropped,
      alreadyListed: fresh.dropped,
      unique: fresh.items.length,
      shown: shown.length + lead.length,
      more: rest.length - shown.length,
    });
  }
  if (ressorts.includes("sport")) {
    notes.push("The sport feed comes from sportschau.de: its items carry no ressort, are not in date order and repeat; here they are sorted newest first, listed once and grouped under sport.");
  }
  if (ressorts.length > 0) notes.push("Ressort feeds are not editorially ranked: their items are listed newest first; only topStories keep the homepage's ranking.");
  const total = breaking.length + topStories.length + ressortStories.length;
  const parts = [
    breaking.length === 0 ? "no breaking news" : `${breaking.length} breaking (Eilmeldung)`,
    ...(withTop ? [`${topStories.length} top stories`] : []),
    ...counts.map((c) => `${c.shown} of ${c.unique} ${c.ressort}${c.more > 0 ? ` (${c.more} more)` : ""}`),
  ];
  return {
    status: total === 0 ? "empty" : "ok",
    ...(total === 0 ? { reason: `The feeds came back empty (${[...(withTop ? ["homepage"] : []), ...ressorts].join(", ")}): nothing to report right now, no outage implied.` } : {}),
    verdict: parts.join("; "),
    breaking,
    topStories,
    ressortStories,
    ressorts: counts,
    ...(regionalLeftOut === undefined ? {} : { regionalLeftOut }),
    notes,
  };
}

// ---- getRegionalNews ---------------------------------------------------------------------------

/** At most this many states per call: one request each, of the API's 60 an hour. */
export const MAX_REGIONAL_STATES = 4;

/** The input of {@link getRegionalNews}. */
export interface RegionalInput {
  /** One to four Bundesländer: names, codes, region ids or big cities. */
  states: readonly string[];
  /** Only items whose title, topline, teaser or tags mention this (filtered here, not by the API). */
  topic?: string | undefined;
  /** At most this many items per state, newest first (1–30, default 10). */
  perState?: number | undefined;
}

/** One state of a regional answer, counted. */
export interface StateCount {
  query: string;
  id: Region;
  name: string;
  /** Different items the state's feed held (copies dropped). */
  items: number;
  /** Of those, the ones that mention the topic (without a topic, all). */
  matched: number;
  /** Matched items already listed under an earlier state of this call (Berlin and Brandenburg share many). */
  alsoUnder: number;
  shown: number;
  more: number;
  broadcasters: string[];
  /** The date of the state's newest item: a regional feed can be days old (BR's was two). */
  newest?: string;
  /** getNewsFeed's cursor for this state's older items. */
  nextDate?: string;
}

/** The answer of {@link getRegionalNews}. */
export type RegionalNews =
  | {
      status: "ok" | "empty";
      reason?: string;
      verdict: string;
      states: StateCount[];
      /** Every state's items, newest first per state, labelled with the state asked for. */
      stories: (Headline & { state: string })[];
      notes: string[];
    }
  | { status: "ambiguous"; query: string; reason: string; candidates: { id: Region; name: string }[] };

/** The `date` (YYMMDD) of a `nextPage` URL, or undefined. */
function nextDateOf(nextPage: unknown): string | undefined {
  if (typeof nextPage !== "string") return undefined;
  try {
    const date = new URL(nextPage).searchParams.get("date");
    return date !== null && newsDateProblem(date) === undefined ? date : undefined;
  } catch {
    return undefined;
  }
}

/** True when `h` mentions `topic`'s words (`mentionsWords`) in its title, topline, teaser or tags. */
function mentions(h: Headline, topic: string): boolean {
  return [h.title, h.topline, h.firstSentence, ...(h.tags ?? [])].some((field) => field !== undefined && mentionsWords(field, topic));
}

/**
 * The regional news of one to four Bundesländer, by name: each name resolved to its region id
 * (`resolveState`; "Frankfurt" alone is ambiguous and nothing is requested), then one request per
 * state, because states asked together share one page and a quiet state is crowded out (Bremen got
 * 1 of 90). Berlin and Brandenburg come as a pair (rbb): either feed carries items tagged with
 * both, said in `notes`. A topic is filtered here on title, topline, teaser and tags, since the
 * API ignores the region when a Ressort is sent. Per state newest first, cut to `perState`, with
 * the count left; an item listed under an earlier state is not listed again.
 */
export async function getRegionalNews(client: TagesschauClient, input: RegionalInput): Promise<RegionalNews> {
  const queries = input.states;
  if (!Array.isArray(queries) || queries.length === 0) throw new TagesschauValidationError("states must name at least one Bundesland.");
  if (queries.length > MAX_REGIONAL_STATES) {
    throw new TagesschauValidationError(`At most ${MAX_REGIONAL_STATES} states per call (one request each; the API allows 60 an hour).`);
  }
  const resolved: { query: string; state: State }[] = [];
  for (const raw of queries) {
    const query = freeText("state", raw, 100);
    const lookup = resolveState(query);
    if (lookup.status === "unknown") throw unknownState(lookup.query);
    if (lookup.status === "ambiguous") {
      return { status: "ambiguous", query: lookup.query, reason: `${quoteValue(lookup.query)} is ambiguous: ${lookup.why}. Ask which one, then call again with the state's name.`, candidates: lookup.candidates };
    }
    if (!resolved.some((r) => r.state.id === lookup.state.id)) resolved.push({ query, state: lookup.state });
  }
  const topic = input.topic === undefined ? undefined : freeText("topic", input.topic, 100);
  const perState = countOf("perState", input.perState, 1, 30, 10);
  const listed = new Set<string>();
  const states: StateCount[] = [];
  const stories: (Headline & { state: string })[] = [];
  for (const { query, state } of resolved) {
    const feed = await client.news({ regions: [state.id] });
    const all = dedup(feed.news.flatMap((item) => {
      const h = headlineOf(item);
      return h === undefined ? [] : [h];
    })).items;
    const matched = newestFirst(topic === undefined ? all : all.filter((h) => mentions(h, topic)));
    const fresh = dedup(matched, listed);
    const shown = fresh.items.slice(0, perState);
    stories.push(...shown.map((h) => ({ ...h, state: state.name })));
    const nextDate = nextDateOf(feed.nextPage);
    const newest = newestFirst(all)[0]?.date;
    states.push({
      query,
      id: state.id,
      name: state.name,
      items: all.length,
      matched: matched.length,
      alsoUnder: fresh.dropped,
      shown: shown.length,
      more: fresh.items.length - shown.length,
      broadcasters: [...new Set(all.flatMap((h) => (h.broadcaster === undefined ? [] : [h.broadcaster])))],
      ...(newest === undefined ? {} : { newest }),
      ...(nextDate === undefined ? {} : { nextDate }),
    });
  }
  const notes: string[] = [];
  if (resolved.some((r) => r.state.id === "3" || r.state.id === "4")) {
    notes.push("Berlin and Brandenburg come as a pair: rbb serves them jointly, so either feed carries items tagged with both (regions). Say Berlin/Brandenburg.");
  }
  if (topic !== undefined) {
    notes.push(`Filtered here for ${quoteValue(topic)} as a word (or a word's start, or from 4 letters a compound's end) on title, topline, teaser and tags: the API can't combine a region with a Ressort (it drops the region). Regional items have no ressort, and MDR items no tags.`);
  }
  notes.push("firstSentence is missing on most NDR and MDR items: use the topline. Each item links to its broadcaster's site (shareURL).");
  const empty = states.filter((s) => s.shown === 0 && s.alsoUnder === 0);
  const status = stories.length === 0 ? "empty" : "ok";
  const reason =
    empty.length === 0
      ? undefined
      : empty
          .map((s) => (topic !== undefined && s.items > 0 ? `None of ${s.name}'s ${s.items} current items mentions ${quoteValue(topic)}; try a broader word or no topic.` : `Aktuell keine regionalen Meldungen für ${s.name}.`))
          .join(" ");
  return {
    status,
    ...(reason === undefined ? {} : { reason }),
    verdict: states
      .map((s) => `${s.name}: ${s.shown} shown of ${s.matched - s.alsoUnder}${topic === undefined ? "" : ` mentioning ${quoteValue(topic)} (of ${s.items})`}${s.newest === undefined ? "" : `, newest ${s.newest.slice(0, 10)}`}`)
      .join("; "),
    states,
    stories,
    notes,
  };
}

// ---- getTopicCoverage ------------------------------------------------------------------------

/** The input of {@link getTopicCoverage}. */
export interface CoverageInput {
  /** The search text: a word or phrase, matched literally (spell ä, ö, ü, ß). */
  query: string;
  /** Hits per page (1–50, default 25). */
  pageSize?: number | undefined;
  /** 1-based page: 1 (default) is the first. */
  page?: number | undefined;
  /** The clock of the timeline (tests); default now. */
  now?: (() => Date) | undefined;
}

/** The answer of {@link getTopicCoverage}. */
export interface Coverage {
  status: "ok" | "empty";
  reason?: string;
  verdict: string;
  query: string;
  /** Hits across all pages: the coverage-volume number to lead with. */
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  nextPage?: number;
  /** Articles of this page, newest first. */
  stories: Headline[];
  /** Videos of this page (no article page; a stream link), newest first. */
  videos: Headline[];
  /** Near-identical hits of this page listed once. */
  duplicatesDropped: number;
  /** This page's hits by age (Europe/Berlin calendar days): is coverage rising or fading? */
  timeline: { today: number; lastSevenDays: number; older: number; newest?: string; oldest?: string };
  spellingNote?: string;
}

/** The calendar day of `time` in Europe/Berlin, as days since the epoch. */
function berlinDay(time: number): number {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(time))
    .split("-")
    .map(Number);
  return Date.UTC(y as number, (m as number) - 1, d as number) / 86_400_000;
}

/**
 * How much Tagesschau covers a topic: the full-text search's total hit count (the headline
 * number), one page of hits, the stories and the videos apart (videos have no article page),
 * each newest first (search results are not in date order), near-identical hits (live coverage
 * makes several videos of one title a day) once, and a timeline of the page by age. `page` is
 * 1-based here, so the trap of the API's 0-based resultPage (starting at 1 skips the newest hits)
 * can't happen; a page past the last is `empty`, naming the last. The search matches spellings
 * literally: an ASCII text with ae/oe/ue/ss gets a `spellingNote`.
 */
export async function getTopicCoverage(client: TagesschauClient, input: CoverageInput): Promise<Coverage> {
  const problem = searchTextProblem(input.query);
  if (problem !== undefined) throw new TagesschauValidationError(problem);
  const pageSize = countOf("pageSize", input.pageSize, 1, 50, 25);
  const page = countOf("page", input.page, 1, 10_000, 1);
  const answer = await client.search({ searchText: input.query, pageSize, resultPage: page - 1 });
  const query = answer.searchText ?? input.query.normalize("NFKC").trim();
  const total = answer.totalItemCount ?? answer.searchResults.length;
  const pages = Math.ceil(total / pageSize);
  const hits = answer.searchResults.flatMap((item) => {
    const h = headlineOf(item, { teaser: true });
    return h === undefined ? [] : [h];
  });
  const byId = dedup(hits);
  // Near-identical: the same title on the same day (live coverage repeats videos).
  const seenTitles = new Set<string>();
  const unique = byId.items.filter((h) => {
    const key = `${fold(h.title)}|${h.date?.slice(0, 10) ?? ""}|${h.type === "video" ? "v" : "s"}`;
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });
  const duplicatesDropped = hits.length - unique.length;
  const sorted = newestFirst(unique);
  const stories = sorted.filter((h) => h.type !== "video");
  const videos = sorted.filter((h) => h.type === "video");
  const now = (input.now ?? (() => new Date()))().getTime();
  const today = berlinDay(now);
  const timeline = { today: 0, lastSevenDays: 0, older: 0 } as Coverage["timeline"];
  for (const h of sorted) {
    const t = timeOf(h);
    if (t === Number.NEGATIVE_INFINITY) continue;
    const age = today - berlinDay(t);
    if (age <= 0) timeline.today++;
    else if (age < 7) timeline.lastSevenDays++;
    else timeline.older++;
  }
  const dated = sorted.filter((h) => h.date !== undefined);
  if (dated.length > 0) {
    timeline.newest = (dated[0] as Headline).date as string;
    timeline.oldest = (dated[dated.length - 1] as Headline).date as string;
  }
  const spellingNote = searchSpellingHint(input.query);
  let reason: string | undefined;
  if (total === 0) {
    reason = `No Tagesschau coverage of ${quoteValue(query)} right now (0 hits): the topic isn't covered, or try a broader word or a synonym${spellingNote === undefined ? "" : ", or the spelling with ä, ö, ü or ß"}.`;
  } else if (sorted.length === 0) {
    reason = `Page ${page} is past the last page (${pages} pages of ${pageSize} for ${total} hits).`;
  }
  return {
    status: reason === undefined ? "ok" : "empty",
    ...(reason === undefined ? {} : { reason }),
    verdict: `${total} hits for ${quoteValue(query)}; page ${page} of ${pages} (${pageSize} per page): ${stories.length} articles, ${videos.length} videos`,
    query,
    total,
    page,
    pages,
    pageSize,
    ...(page < pages ? { nextPage: page + 1 } : {}),
    stories,
    videos,
    duplicatesDropped,
    timeline,
    ...(spellingNote === undefined ? {} : { spellingNote }),
  };
}

// ---- getLiveStreams --------------------------------------------------------------------------

/** One channel with its playable links. */
export interface Channel {
  title: string;
  sophoraId: string;
  /** live: the always-on livestream; edition: a dated broadcast; accessible: Einfache Sprache, Gebärdensprache. */
  kind: "live" | "edition" | "accessible";
  /** Air time of a dated edition; absent on the livestream. */
  date?: string;
  /** The HLS link (streams.adaptivestreaming), when there is one. */
  hls?: string;
  /** Every link by protocol (adaptivestreaming, h264s/m/xl as MP4). */
  streams: Record<string, string>;
  available: boolean;
}

/** The answer of {@link getLiveStreams}. */
export interface LiveStreams {
  status: "ok" | "empty";
  reason?: string;
  verdict: string;
  channels: Channel[];
  notes: string[];
}

/** The kind of a channel by its title and date. */
function kindOf(title: string, date: string | undefined): Channel["kind"] {
  if (/einfache[rn]? sprache|gebärdensprache|gebaerdensprache/i.test(title)) return "accessible";
  if (/livestream/i.test(title) || date === undefined) return "live";
  return "edition";
}

/**
 * The live and broadcast channels with their playable links: `streams` is an object keyed by
 * protocol, read whole (the HLS link is `adaptivestreaming`); a channel without streams is listed
 * as unavailable, never with a blank link. Grouped live, editions, accessible. Two entries of one
 * title (two tagesschau editions) are both kept, told apart by date. `show` narrows to the titles
 * containing it, or its words in another inflection (Einfache Sprache); none is `empty`, naming
 * the titles there are, never a guessed link.
 */
export async function getLiveStreams(client: TagesschauClient, input: { show?: string | undefined } = {}): Promise<LiveStreams> {
  const show = input.show === undefined ? undefined : freeText("show", input.show, 100);
  const answer = await client.channels();
  const order = { live: 0, edition: 1, accessible: 2 } as const;
  const all = answer.channels
    .flatMap((item): Channel[] => {
      const title = text(item, "title");
      if (title === undefined) return [];
      const date = text(item, "date");
      const streams: Record<string, string> = {};
      if (isObject(item["streams"])) {
        for (const [protocol, url] of Object.entries(item["streams"])) if (typeof url === "string" && url.trim() !== "") streams[protocol] = url.trim();
      }
      const hls = streams["adaptivestreaming"];
      return [{ title, sophoraId: text(item, "sophoraId") ?? "", kind: kindOf(title, date), ...(date === undefined ? {} : { date }), ...(hls === undefined ? {} : { hls }), streams, available: Object.keys(streams).length > 0 }];
    })
    .map((c, i) => ({ c, i }))
    .sort((a, b) => order[a.c.kind] - order[b.c.kind] || a.i - b.i)
    .map(({ c }) => c);
  // The title as typed (folded, spaces aside), or its words with an inflection left aside: the
  // channel is "tagesschau in Einfacher Sprache", a user types "Einfache Sprache".
  const channels = show === undefined ? all : all.filter((c) => fold(c.title).includes(fold(show)) || mentionsWords(c.title, show));
  const notes = ["HLS links (.m3u8) play in VLC, mpv, Safari or any HLS player; h264 links are MP4 files of a dated edition."];
  const titles = all.map((c) => c.title);
  const repeated = [...new Set(titles.filter((t, i) => titles.indexOf(t) !== i))];
  if (repeated.length > 0) notes.push(`Listed more than once: ${repeated.map((t) => quoteValue(t)).join(", ")}: different editions, told apart by date.`);
  const unavailable = channels.filter((c) => !c.available).length;
  let reason: string | undefined;
  if (all.length === 0) reason = "The channels feed came back empty: no channel is offered right now.";
  else if (channels.length === 0) reason = `No channel's title contains ${quoteValue(show as string)}. The channels offered: ${[...new Set(titles)].join("; ")}.`;
  return {
    status: reason === undefined ? "ok" : "empty",
    ...(reason === undefined ? {} : { reason }),
    verdict: `${channels.length} channels${channels.some((c) => c.kind === "live" && c.available) ? ", the livestream among them" : ""}${unavailable > 0 ? `; ${unavailable} without a stream right now` : ""}`,
    channels,
    notes,
  };
}

// ---- getNewsFeed ---------------------------------------------------------------------------

/** The input of {@link getNewsFeed}. */
export interface NewsFeedInput {
  /** One Ressort (not with `state`). */
  ressort?: string | undefined;
  /** One Bundesland by name, code, region id or city (not with `ressort`). */
  state?: string | undefined;
  /** The cursor of an earlier answer's nextDate (YYMMDD): the next, older page. */
  date?: string | undefined;
}

/** The answer of {@link getNewsFeed}. */
export type NewsFeed =
  | {
      status: "ok" | "empty";
      reason?: string;
      filter: { ressort?: Ressort; state?: string; region?: Region; date?: string };
      /** The feed's items in its order, each once. */
      items: Headline[];
      /** Copies the feed repeated, dropped. */
      repeatsDropped: number;
      /** The cursor of the next, older page: pass it back as date. */
      nextDate?: string;
    }
  | { status: "ambiguous"; query: string; reason: string; candidates: { id: Region; name: string }[] };

/**
 * The news feed as the API orders it: unfiltered (the national feed), one Ressort or one
 * Bundesland (by name) — not both, as the API drops the region when a Ressort is sent — and the
 * page cursor `date` (YYMMDD, from `nextDate`) for older items. Each item once (feeds repeat items).
 */
export async function getNewsFeed(client: TagesschauClient, input: NewsFeedInput = {}): Promise<NewsFeed> {
  let ressort: Ressort | undefined;
  if (input.ressort !== undefined) {
    const name = input.ressort.trim().toLowerCase();
    const problem = ressortProblem(name);
    if (problem !== undefined) throw new TagesschauValidationError(problem);
    ressort = name as Ressort;
  }
  let state: State | undefined;
  if (input.state !== undefined) {
    const lookup = resolveState(freeText("state", input.state, 100));
    if (lookup.status === "unknown") throw unknownState(lookup.query);
    if (lookup.status === "ambiguous") {
      return { status: "ambiguous", query: lookup.query, reason: `${quoteValue(lookup.query)} is ambiguous: ${lookup.why}. Ask which one.`, candidates: lookup.candidates };
    }
    state = lookup.state;
  }
  if (ressort !== undefined && state !== undefined) {
    throw new TagesschauValidationError("Give a ressort or a state, not both: the API applies the Ressort and silently drops the region. Fetch the state's feed and filter it instead (getRegionalNews with topic).");
  }
  const date = input.date?.trim();
  const feed = await client.news({ ...(ressort === undefined ? {} : { ressort }), ...(state === undefined ? {} : { regions: [state.id] }), ...(date === undefined ? {} : { date }) });
  const all = feed.news.flatMap((item) => {
    const h = headlineOf(item, { ...(ressort === undefined ? {} : { group: ressort }) });
    return h === undefined ? [] : [h];
  });
  const { items, dropped } = dedup(all);
  const nextDate = nextDateOf(feed.nextPage);
  const filter = { ...(ressort === undefined ? {} : { ressort }), ...(state === undefined ? {} : { state: state.name, region: state.id }), ...(date === undefined ? {} : { date }) };
  return {
    status: items.length === 0 ? "empty" : "ok",
    ...(items.length === 0 ? { reason: `The feed (${Object.entries(filter).map(([k, v]) => `${k} ${v}`).join(", ") || "unfiltered"}) came back empty: nothing there right now, or no older page.` } : {}),
    filter,
    items,
    repeatsDropped: dropped,
    ...(nextDate === undefined ? {} : { nextDate }),
  };
}

// ---- getArticle ---------------------------------------------------------------------------

/** One block of an article's text. */
export interface ArticleBlock {
  /** text, headline, quotation, box (a teaser of another item), related (a link to another item), list. */
  type: string;
  text: string;
  /** For box and related: the other item's id, for getArticle. */
  articleId?: string;
}

/** The answer of {@link getArticle}. */
export type Article =
  | {
      status: "ok";
      articleId: string;
      sophoraId: string;
      title: string;
      topline?: string;
      firstSentence?: string;
      date?: string;
      ressort?: string;
      type?: string;
      breakingNews?: true;
      shareURL: string | null;
      tags?: string[];
      /** The text, block by block, HTML dropped and nothing reworded. */
      blocks: ArticleBlock[];
      /** What the text embeds but this answer leaves out, counted: video, audio, image_gallery, … */
      media: Record<string, number>;
    }
  | { status: "empty"; articleId: string; reason: string };

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** `html` as plain text: tags dropped (a line break for br, a bullet for li), entities decoded, spaces collapsed. */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(?:p|li|ul|ol|h\d)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === "#") {
        const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** The article id in an `<a href="…api2u/….json">` of `html`, if any. */
function linkedArticle(html: unknown): string | undefined {
  if (typeof html !== "string") return undefined;
  const href = /href="([^"]+)"/.exec(html)?.[1];
  return href === undefined ? undefined : articleIdOf(href);
}

/** The text blocks of `content`, and the media it embeds, counted. */
function blocksOf(content: JsonValue | undefined): { blocks: ArticleBlock[]; media: Record<string, number> } {
  const blocks: ArticleBlock[] = [];
  const media: Record<string, number> = {};
  for (const block of Array.isArray(content) ? content : []) {
    if (!isObject(block)) continue;
    const type = typeof block["type"] === "string" ? block["type"] : "unknown";
    const push = (b: ArticleBlock): void => {
      if (b.text !== "") blocks.push(b);
    };
    if ((type === "text" || type === "headline" || type === "list") && typeof block["value"] === "string") {
      push({ type, text: plainText(block["value"]) });
    } else if (type === "quotation" && isObject(block["quotation"]) && typeof block["quotation"]["text"] === "string") {
      push({ type, text: plainText(block["quotation"]["text"]) });
    } else if (type === "box" && isObject(block["box"])) {
      const box = block["box"];
      const parts = [box["subtitle"], box["title"], box["text"]].flatMap((p) => (typeof p === "string" && p.trim() !== "" ? [plainText(p)] : []));
      const articleId = linkedArticle(box["link"]);
      push({ type, text: parts.join(" — "), ...(articleId === undefined ? {} : { articleId }) });
    } else if (type === "related" && Array.isArray(block["related"])) {
      for (const item of block["related"]) {
        if (!isObject(item) || typeof item["title"] !== "string") continue;
        const articleId = typeof item["details"] === "string" ? articleIdOf(item["details"]) : undefined;
        push({ type, text: plainText(item["title"]), ...(articleId === undefined ? {} : { articleId }) });
      }
    } else {
      media[type] = (media[type] ?? 0) + 1;
    }
  }
  return { blocks, media };
}

/**
 * One item's full text by its article id (an answer's `articleId`, or its details URL): every
 * text block with its type, HTML dropped and nothing reworded, teasers of other items with their
 * ids, and the embedded media counted (videos, galleries; not passed on). An id the API no longer
 * has (depublished, or never there) is `empty` with the reason, never a bare not found.
 */
export async function getArticle(client: TagesschauClient, input: { article: string }): Promise<Article> {
  const problem = articleIdProblem(input.article);
  if (problem !== undefined) throw new TagesschauValidationError(problem);
  const articleId = articleIdOf(input.article) as string;
  let item: NewsItem;
  try {
    item = await client.article(articleId);
  } catch (error) {
    if (error instanceof TagesschauApiError && (error.status === 404 || error.status === 410)) {
      return {
        status: "empty",
        articleId,
        reason: `No item under ${quoteValue(articleId)} (HTTP ${error.status}): it may have been taken offline (Depublizierung), or the id is not one an answer gave. Take ids from a fresh answer.`,
      };
    }
    throw error;
  }
  // The client checks the title is a string; a blank one leaves no headline: an answer of a shape
  // this code can't read, said as such (a TypeError on it was an internal error).
  const h = headlineOf(item);
  if (h === undefined) throw new TagesschauParseError(`The item ${quoteValue(articleId)} came back with no title: the API's answer is not in the expected shape.`);
  const { blocks, media } = blocksOf(item["content"]);
  return {
    status: "ok",
    articleId,
    sophoraId: h.sophoraId,
    title: h.title,
    ...(h.topline === undefined ? {} : { topline: h.topline }),
    ...(h.firstSentence === undefined ? {} : { firstSentence: h.firstSentence }),
    ...(h.date === undefined ? {} : { date: h.date }),
    ...(h.ressort === undefined ? {} : { ressort: h.ressort }),
    ...(h.type === undefined ? {} : { type: h.type }),
    ...(h.breakingNews ? { breakingNews: true as const } : {}),
    shareURL: h.shareURL,
    ...(h.tags === undefined ? {} : { tags: h.tags }),
    blocks,
    media,
  };
}
