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
**region(s)** or by a **Ressort** — not both: the API applies the Ressort and
silently ignores the regions, so the CLI and the client refuse the combination
before any request. CLI: `news`. Returns a `NewsResult`
(`news`, `regional`, optional `nextPage` cursor).

**Channels (`/api2u/channels/`).** The live and broadcast channels (the
linear/streaming programme feed). CLI: `channels`. Returns a `ChannelsResult`
(`channels`).

**Search (`/api2u/search/`).** Full-text search across articles. CLI:
`search <text>`. Returns a `SearchResult` (`searchResults`, `totalItemCount`,
the echoed `searchText`/`pageSize`/`resultPage`, and `type`/`details`).

---

## Filters, parameters & identifiers

**Ressort.** The topic/department of a news item — the German newsroom term for a
news category. The news endpoint accepts one Ressort via `--ressort`. The values
the client surfaces (`RessortValues`) are:
`inland`, `ausland`, `wirtschaft`, `sport`, `video`, `investigativ`, `wissen`.
Any other value (wrong case, padded or blank included) is rejected before any request
by the client (`ressortProblem`) and so by the CLI.

**Region (Bundesland id).** A German federal state, identified by a numeric id
**`1`–`16`** in the order the API documents the Bundesländer. Passed to the news
endpoint via the repeatable `--region` flag; the client joins multiple ids into a
single comma-separated `regions` query value (e.g. `?regions=5,9`). The accepted
ids are exposed as `RegionValues`; any other value (`17`, `09`, ` 9`, `9,10`, blank)
is rejected before any request by the client (`regionProblem`) and so by the CLI.

**searchText.** The free-text query for the search endpoint (the positional
`<text>` argument of `search`). Sent to the API as typed, except that it is
normalised to Unicode NFKC first (a decomposed umlaut, as pasted from macOS file
names or PDFs, otherwise finds nothing). The API folds case but matches spellings
literally (`Strasse` finds far fewer hits than `Straße`); for a text that may be such an
ASCII spelling the CLI prints a note on stderr (`searchSpellingHint`). A blank or missing value is rejected
before any request by the client (`searchTextProblem`, a
`TagesschauValidationError`) and so by the CLI.

**pageSize / resultPage.** The search endpoint's paging parameters, exposed as
`--page-size` / `--result-page`. `pageSize` is the number of hits per page and must
be `>= 1`. `resultPage` is a **0-based** page index: `0` (the default) is the first
page, and an index past the last page returns no hits. Both are at most
`2147483647` (`MAX_SEARCH_INT`, a 32-bit integer upstream). A value out of range, or
not an integer, is rejected before any request by the client (`pageSizeProblem` /
`resultPageProblem`) and so by the CLI.

**nextPage.** A URL returned by the news endpoint pointing at the next, older
page of results, when present: the same filters plus a **`date`** cursor written
`YYMMDD` (`…/api2u/news?date=260924&regions=9`). Follow it with `news --date
260924` and the same filters (library: `news({ date: "260924" })`); a malformed or
impossible date is rejected before any request.

**news / regional.** The two item lists returned by the homepage and news
feeds: the main feed and the regional block. Each entry is a **news item**.

**News item.** A single story or article. Its shape varies by item type (content
blocks, image variants, tracking metadata), so the client exposes each item as a
faithful raw `JsonObject` (`NewsItem`) rather than a partially-guessed type.

---

## Search & API behaviour

**No authentication.** The Tagesschau API is fully open; this client sends no
key, token or cookie. It only issues read-only `GET` requests.

**Rate limiting / transient errors.** The API allows about **60 requests an
hour**. When it answers with a transient status (**429** Too Many Requests,
**503** Service Unavailable), the client retries automatically, up to
`--max-retries` times (default `2`, at most `10`). Each retry waits 200 ms ×
attempt, or the response's `Retry-After` (seconds or an HTTP date) when that is
longer and at most 30 s (`MAX_RETRY_AFTER_MS`): `Retry-After: 0` never makes the
client retry at once. A longer one is not retried; the error surfaces at once and
names the wait the server asked for.

**Redirects.** The client follows up to `--max-redirects` redirects (default
`5`). Credentials in `--base-url` (`https://user:pw@host`) go out as an
`Authorization` header to the base URL's own origin (scheme, host and port) only:
a same-origin redirect keeps them, relative or absolute; on a **cross-origin** hop
the client strips credential-bearing headers (`Authorization`, `X-API-Key`,
`Cookie`) before the next request so they can never leak to an unintended host. If
the target then answers 401 or 403, the error says the redirect dropped them (for
an `http:` → `https:` redirect: use an `https:` base URL). A user name or password
in a redirect's `Location` is never used.

**Response size cap.** Responses larger than `--max-response-bytes` (default
**100 MiB**; `0` = unlimited) are aborted to defend against memory exhaustion
from a hostile or buggy endpoint.

---

## Exit codes

**Exit codes.** The CLI maps outcomes to process exit codes: `0` success;
`4` on a `404` from the API; `1` for any other error (API error, network failure,
unexpected); and a non-zero commander code for usage / argument-validation errors.
`--help`/`--version` return `0`.

**Log record.** Every diagnostic line the CLI writes to stderr: a timestamp, a level
(`ERROR`, `WARN`, `INFO`) and a topic `tagesschau.<area>`, as text (log4j style) or with
`--log-format jsonl` as one JSON object per line. The areas: `cli` (usage errors,
commander's messages, unexpected errors), `api` (the API's answers: an error status, a
malformed answer — bad JSON, the wrong shape, an unknown charset — and the
search-spelling note), `http` (the connection, the cleartext warning) and `output` (a
failed write to stdout). A record is always one line; control characters in it are
escaped.

---

> **Library & internals.** Terms for the TypeScript client and its internals —
> `TagesschauClient`, the request engine, transport, retry/backoff, error types,
> query builder — live in **[DEVELOPING.md](DEVELOPING.md)**.
