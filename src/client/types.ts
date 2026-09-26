// Domain types for the Tagesschau API (tagesschau.de).
//
// News items are deeply nested (content blocks, image variants, tracking
// metadata) and the shape varies by item type, so the envelopes are typed
// precisely while individual items are exposed as faithful raw `JsonObject`s.

import type { Ressort } from "./enums.js";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** A single news item / story. Shape varies; exposed as a raw object. */
export type NewsItem = JsonObject;

/** Response of `/api2u/homepage/`. */
export interface HomepageResult {
  news: NewsItem[];
  regional: NewsItem[];
  newStoriesCountLink?: string;
  type?: string;
}

/** Response of `/api2u/news/`. */
export interface NewsResult {
  news: NewsItem[];
  regional: NewsItem[];
  newStoriesCountLink?: JsonValue;
  type?: string;
  /**
   * URL of the next (older) page, when present, e.g.
   * `https://www.tagesschau.de/api2u/news?date=260925&regions=5,9`: the same filters
   * plus a `date` (YYMMDD). Follow it with `news({ ..., date: "260925" })`.
   */
  nextPage?: string;
}

/** Response of `/api2u/channels/`. */
export interface ChannelsResult {
  channels: JsonObject[];
  type?: string;
}

/**
 * Response of `/api2u/search/`. Live (2026-09-26) it carries exactly these keys:
 * `type` ("search"), `details` (the endpoint URL), the echoed `searchText`,
 * `pageSize` and `resultPage`, `totalItemCount` and `searchResults`.
 */
export interface SearchResult {
  type?: string;
  /** The endpoint's own URL, e.g. `https://www.tagesschau.de/api2u/search`. */
  details?: string;
  /** Echo of the search text. */
  searchText?: string;
  /** Hits per page actually used (default 25). */
  pageSize?: number;
  /** The 0-based index of the page returned. */
  resultPage?: number;
  /** Total hits across all pages. */
  totalItemCount?: number;
  searchResults: JsonObject[];
}

/** Parameters for the news endpoint. */
export interface NewsParams {
  /** Bundesland ids (1..16); serialised as a comma-separated `regions` value. */
  regions?: string[];
  ressort?: Ressort;
  /**
   * The page cursor from `nextPage`: a date as `YYMMDD` (e.g. `"260925"`). Checked
   * for shape and a real calendar day before any request.
   */
  date?: string;
}

/** Parameters for the search endpoint. */
export interface SearchParams {
  searchText?: string;
  pageSize?: number;
  /** 0-based page index: 0 (or omitted) is the first page. */
  resultPage?: number;
}
