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
   * rejected with a `TagesschauError` before any request.
   */
  async news(params: NewsParams = {}): Promise<NewsResult> {
    const regions = params.regions ?? [];
    if (regions.length > 0 && params.ressort !== undefined) {
      throw new TagesschauError(
        "ressort and regions cannot be combined: the API applies the Ressort and silently ignores the regions, " +
          "so every item would come back national (regionId 0). Fetch the region feed and filter it locally instead.",
      );
    }
    const query: QueryParams = {};
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
