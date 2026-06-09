# Glossary

A reference for the domain concepts and project-specific terms used throughout
`tagesschau-cli`. The Tagesschau domain is German; this glossary gives the term
as it appears in the API/CLI alongside the German word where one is in common use.

> **Quick orientation.** This tool wraps the open, no-auth **Tagesschau API**
> (`tagesschau.de`), ARD-aktuell's structured German news feed. Everything is a
> read-only `GET`; there is no key, no upload and no write.

---

## The Tagesschau API

**Tagesschau.** Germany's flagship television news programme, produced by
**ARD-aktuell** and broadcast by the public-service broadcaster ARD. Its website
`tagesschau.de` publishes the same editorial output as structured data.

**ARD — Arbeitsgemeinschaft der öffentlich-rechtlichen Rundfunkanstalten.** The
consortium of regional public-service broadcasters in Germany that produces and
carries the Tagesschau. **ARD-aktuell** is the joint newsroom responsible for the
content this API serves.

**Tagesschau API.** The undocumented-but-open REST interface behind
`tagesschau.de`, served under the path prefix **`/api2u`** (e.g.
`https://www.tagesschau.de/api2u/homepage/`). It needs no authentication and is
read-only. Community documentation lives at
[tagesschau.api.bund.dev](https://tagesschau.api.bund.dev/).

**`/api2u`.** The base path of the API on the host. Every endpoint this client
calls is `${baseUrl}/api2u/<resource>/` — the default `baseUrl` is
`https://www.tagesschau.de`.

---

## Resources & endpoints

The CLI mirrors the API resources; each is one top-level command.

**Homepage (`/api2u/homepage/`).** The curated front-page feed: the editorially
selected top stories plus a regional block. CLI: `homepage`. Returns a
`HomepageResult` (`news`, `regional`).

**News (`/api2u/news/`).** The general news feed, optionally narrowed by
**region(s)** and/or a **Ressort**. CLI: `news`. Returns a `NewsResult`
(`news`, `regional`, optional `nextPage` cursor).

**Channels (`/api2u/channels/`).** The live and broadcast channels (the
linear/streaming programme feed). CLI: `channels`. Returns a `ChannelsResult`
(`channels`).

**Search (`/api2u/search/`).** Full-text search across articles. CLI:
`search <text>`. Returns a `SearchResult` (`searchResults`, optional
`totalItemCount`).

---

## Filters, parameters & identifiers

**Ressort.** The topic/department of a news item — the German newsroom term for a
news category. The news endpoint accepts one Ressort via `--ressort`. The values
the client surfaces (`RessortValues`) are:
`inland`, `ausland`, `wirtschaft`, `sport`, `video`, `investigativ`, `wissen`.

**Region (Bundesland id).** A German federal state, identified by a numeric id
**`1`–`16`** in the order the API documents the Bundesländer. Passed to the news
endpoint via the repeatable `--region` flag; the client joins multiple ids into a
single comma-separated `regions` query value (e.g. `?regions=5,9`). The accepted
ids are exposed as `RegionValues`.

**searchText.** The free-text query for the search endpoint (the positional
`<text>` argument of `search`). Sent verbatim to the API; an empty value is
rejected client-side by the CLI.

**pageSize / resultPage.** The search endpoint's **1-based** paging parameters,
exposed as `--page-size` / `--result-page`. Both must be `>= 1`; `0` is rejected
because the API's paging is 1-based.

**nextPage.** A cursor URL returned by the news endpoint pointing at the next
page of results, when present.

**news / regional.** The two item lists returned by the homepage and news
feeds: the main feed and the regional block. Each entry is a **news item**.

**News item.** A single story or article. Its shape varies by item type (content
blocks, image variants, tracking metadata), so the client exposes each item as a
faithful raw `JsonObject` (`NewsItem`) rather than a partially-guessed type.

---

## Search & API behaviour

**No authentication.** The Tagesschau API is fully open; this client sends no
key, token or cookie. It only issues read-only `GET` requests.

**Rate limiting / transient errors.** When the API answers with a transient
status (**429** Too Many Requests, **503** Service Unavailable), the client
retries automatically with linear backoff (`--max-retries`, default `2`).

**Redirects.** The client follows up to `--max-redirects` redirects (default
`5`). On a **cross-origin** hop it strips credential-bearing headers
(`Authorization`, `X-API-Key`, `Cookie`) before the next request so they can
never leak to an unintended host; same-origin redirects keep all headers.

**Response size cap.** Responses larger than `--max-response-bytes` (default
**100 MiB**; `0` = unlimited) are aborted to defend against memory exhaustion
from a hostile or buggy endpoint.

---

## Exit codes

**Exit codes.** The CLI maps outcomes to process exit codes: `0` success;
`4` on a `404` from the API; `1` for any other error (API error, network failure,
unexpected); and a non-zero commander code for usage / argument-validation errors.
`--help`/`--version` return `0`.

---

> **Library & internals.** Terms for the TypeScript client and its internals —
> `TagesschauClient`, the request engine, transport, retry/backoff, error types,
> query builder — live in **[DEVELOPING.md](DEVELOPING.md)**.
