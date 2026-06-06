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
  /** Cursor URL for the next page, when present. */
  nextPage?: string;
}

/** Response of `/api2u/channels/`. */
export interface ChannelsResult {
  channels: JsonObject[];
  type?: string;
}

/** Response of `/api2u/search/`. */
export interface SearchResult {
  type?: string;
  searchText?: string;
  totalItemCount?: number;
  searchResults: JsonObject[];
  query?: string;
}

/** Parameters for the news endpoint. */
export interface NewsParams {
  /** Bundesland ids (1..16); serialised as a comma-separated `regions` value. */
  regions?: string[];
  ressort?: Ressort;
}

/** Parameters for the search endpoint. */
export interface SearchParams {
  searchText?: string;
  pageSize?: number;
  resultPage?: number;
}
