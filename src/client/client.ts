// TagesschauClient — a typed client over the open (no-auth) endpoints of the
// Tagesschau API (https://www.tagesschau.de/api2u), ARD-aktuell's structured
// German news feed.
//
//   client.homepage()
//   client.news({ ressort: "wirtschaft" })
//   client.search({ searchText: "Bundestag" })

import { RequestEngine, type EngineOptions } from "./engine.js";
import type { QueryParams } from "./query.js";
import { TagesschauError, TagesschauParseError } from "./errors.js";
import type {
  HomepageResult,
  NewsResult,
  ChannelsResult,
  SearchResult,
  NewsParams,
  SearchParams,
} from "./types.js";

const API = "/api2u";

/**
 * Why a news `date` cursor is unusable, or `undefined` when it is a real calendar
 * day written `YYMMDD` — the form the API puts into `nextPage` (`?date=260925`).
 */
export function newsDateProblem(date: string): string | undefined {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(date);
  const problem = `Invalid date ${JSON.stringify(date)}: expected YYMMDD (e.g. 260925), as in the date parameter of nextPage.`;
  if (!m) return problem;
  const [yy, mm, dd] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const day = new Date(Date.UTC(2000 + yy, mm - 1, dd));
  if (day.getUTCMonth() !== mm - 1 || day.getUTCDate() !== dd) return problem;
  return undefined;
}

/** A non-null, non-array JSON object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shapeError(path: string, expected: string): TagesschauParseError {
  return new TagesschauParseError(`Unexpected response shape from ${path}: expected ${expected}.`);
}

/**
 * Check the top-level shape callers rely on — a JSON object whose `key` is an array
 * (and, for the feeds, whose `regional` is an array when present) — so a `null`,
 * `{}` or wrong-typed 2xx body is a TagesschauParseError instead of a silent
 * success or a TypeError in the caller. Items are not checked (their shape varies).
 */
function assertEnvelope(body: unknown, path: string, key: string, optionalArrays: string[] = []): void {
  if (!isObject(body) || !Array.isArray(body[key])) {
    throw shapeError(path, `a JSON object with a "${key}" array`);
  }
  for (const k of optionalArrays) {
    if (body[k] !== undefined && !Array.isArray(body[k])) throw shapeError(path, `"${k}" to be an array`);
  }
}

export class TagesschauClient {
  private readonly engine: RequestEngine;

  constructor(options: EngineOptions = {}) {
    this.engine = new RequestEngine(options);
  }

  /** The curated homepage feed (top news + regional). */
  async homepage(): Promise<HomepageResult> {
    const path = `${API}/homepage/`;
    const body = await this.engine.getJson<unknown>(path);
    assertEnvelope(body, path, "news", ["regional"]);
    return body as HomepageResult;
  }

  /**
   * The news feed, optionally filtered by region(s) or by Ressort — not both: the
   * API applies the Ressort and silently ignores the regions, so the combination is
   * rejected with a `TagesschauError` before any request. `date` (YYMMDD) is the
   * page cursor the API puts into `nextPage`; pass it to fetch that older page.
   */
  async news(params: NewsParams = {}): Promise<NewsResult> {
    const regions = params.regions ?? [];
    if (regions.length > 0 && params.ressort !== undefined) {
      throw new TagesschauError(
        "ressort and regions cannot be combined: the API applies the Ressort and silently ignores the regions, " +
          "so every item would come back national (regionId 0). Fetch the region feed and filter it locally instead.",
      );
    }
    if (params.date !== undefined) {
      const problem = newsDateProblem(params.date);
      if (problem !== undefined) throw new TagesschauError(problem);
    }
    const query: QueryParams = {};
    if (params.date !== undefined) query["date"] = params.date;
    if (regions.length > 0) query["regions"] = regions.join(",");
    if (params.ressort !== undefined) query["ressort"] = params.ressort;
    const path = `${API}/news/`;
    const body = await this.engine.getJson<unknown>(path, query);
    assertEnvelope(body, path, "news", ["regional"]);
    return body as NewsResult;
  }

  /** The live/broadcast channels. */
  async channels(): Promise<ChannelsResult> {
    const path = `${API}/channels/`;
    const body = await this.engine.getJson<unknown>(path);
    assertEnvelope(body, path, "channels");
    return body as ChannelsResult;
  }

  /**
   * Full-text search across articles. The search text is normalised to NFKC before
   * sending: the API finds nothing for a decomposed umlaut ("Ko" + U+0308, as pasted
   * from macOS file names or PDFs), which looks identical to the composed "Köln"
   * with hundreds of hits; NFKC also folds fullwidth digits and ligatures.
   */
  async search(params: SearchParams = {}): Promise<SearchResult> {
    const query: QueryParams = {
      searchText: params.searchText?.normalize("NFKC"),
      pageSize: params.pageSize,
      resultPage: params.resultPage,
    };
    const path = `${API}/search/`;
    const body = await this.engine.getJson<unknown>(path, query);
    assertEnvelope(body, path, "searchResults");
    const total = (body as Record<string, unknown>)["totalItemCount"];
    if (total !== undefined && !(Number.isSafeInteger(total) && (total as number) >= 0)) {
      throw shapeError(path, "a non-negative integer totalItemCount");
    }
    return body as SearchResult;
  }
}
