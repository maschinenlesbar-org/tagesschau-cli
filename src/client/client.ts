// TagesschauClient — a typed client over the open (no-auth) endpoints of the
// Tagesschau API (https://www.tagesschau.de/api2u), ARD-aktuell's structured
// German news feed.
//
//   client.homepage()
//   client.news({ ressort: "wirtschaft" })
//   client.search({ searchText: "Bundestag" })

import { RequestEngine, type EngineOptions } from "./engine.js";
import type { QueryParams } from "./query.js";
import type {
  HomepageResult,
  NewsResult,
  ChannelsResult,
  SearchResult,
  NewsParams,
  SearchParams,
} from "./types.js";

const API = "/api2u";

export class TagesschauClient {
  private readonly engine: RequestEngine;

  constructor(options: EngineOptions = {}) {
    this.engine = new RequestEngine(options);
  }

  /** The curated homepage feed (top news + regional). */
  homepage(): Promise<HomepageResult> {
    return this.engine.getJson(`${API}/homepage/`);
  }

  /** The news feed, optionally filtered by region(s) and/or Ressort. */
  news(params: NewsParams = {}): Promise<NewsResult> {
    const query: QueryParams = {};
    if (params.regions && params.regions.length > 0) query["regions"] = params.regions.join(",");
    if (params.ressort !== undefined) query["ressort"] = params.ressort;
    return this.engine.getJson(`${API}/news/`, query);
  }

  /** The live/broadcast channels. */
  channels(): Promise<ChannelsResult> {
    return this.engine.getJson(`${API}/channels/`);
  }

  /** Full-text search across articles. */
  search(params: SearchParams = {}): Promise<SearchResult> {
    const query: QueryParams = {
      searchText: params.searchText,
      pageSize: params.pageSize,
      resultPage: params.resultPage,
    };
    return this.engine.getJson(`${API}/search/`, query);
  }
}
