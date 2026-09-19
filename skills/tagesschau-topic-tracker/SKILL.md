---
name: tagesschau-topic-tracker
description: >
  Track how much and how recently Tagesschau is covering a topic, person, or
  keyword using the tagesschau-cli full-text search. Trigger when the user asks
  "what is Tagesschau saying about a topic?", "how much coverage does a topic get?",
  "latest news on a person or event", "search Tagesschau for a keyword", "is a topic in
  the news?", or wants a timeline of coverage. Runs paged search, reports the
  total hit count, sorts results newest-first, and separates articles from video.
compatibility: >
  Requires the `tagesschau` CLI (npm package
  @maschinenlesbar.org/tagesschau-cli) on PATH, installed by the user; the skill
  never installs it. Network access to www.tagesschau.de.
---

# Tagesschau Topic Tracker

Answer "what's Tagesschau saying about <X>, and how much?" — running the full-text search,
surfacing the **total hit count** as a coverage signal, listing the newest hits with
links, and paging deeper when the user wants the full picture.

## Tooling

This skill drives the `tagesschau` command. **Before anything else, validate it is available** — run `command -v tagesschau` (or `tagesschau --version`). If it is not on your PATH, STOP and inform the user that the `tagesschau` CLI (`@maschinenlesbar.org/tagesschau-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

Data comes from the `tagesschau` CLI — read-only, no API key. Pass `--compact`. The positional search text is **required and must be non-empty** — the CLI rejects an empty/whitespace query before any request. A query that matches nothing returns `{ totalItemCount: 0, searchResults: [] }` (exit `0`) — a valid "no coverage" answer.

## Step 1 — Run the search

```bash
tagesschau --compact search "Bundestag"
```

Multi-word queries: quote them (`search "CDU Parteitag"`). The query is sent verbatim;
it's a keyword/phrase match, not boolean — keep terms simple, broaden if you get 0 hits.

The result object:

| Field | Meaning |
|---|---|
| `totalItemCount` | **Total hits across all pages** — the coverage-volume number to lead with |
| `searchResults[]` | This page's hits (raw news-item objects) |
| `searchText` | Echo of your query |
| `pageSize` | Hits per page actually used (**default 25**) |
| `resultPage` | The **0-based** index of the page returned: `0` is the first page (also what you get with no `--result-page`), `1` the second |
| `details` / `type` | Envelope metadata — ignore |

Each entry in `searchResults` carries the same fields as feed items: `title`, `topline`,
`firstSentence`, `date` (ISO 8601 +offset), `ressort` (**often `null`** in search),
`type` (`story` or `video`), `shareURL` (**`null` for video items**), `streams` (present
on videos), `sophoraId`.

## Step 2 — Page for the full set

Default page size is 25. To go wider or deeper:

```bash
# first 40 hits (resultPage 0 — the same as leaving the flag out)
tagesschau --compact search "Wahl" --page-size 40 --result-page 0
# next 40 hits
tagesschau --compact search "Wahl" --page-size 40 --result-page 1
```

> **Trap — `--result-page` is 0-based.** `0` is the first page, `1` the second. Starting
> at `--result-page 1` silently skips the newest hits. `--page-size` must be `>= 1`;
> `--result-page` takes any integer `>= 0`.

There are `ceil(totalItemCount / pageSize)` pages, so the last index is one less; an
index past the end returns an empty `searchResults`. Fetch only as many pages as the user
needs (1 page for "is X in the news?", more for "give me everything on X"). Don't loop the
whole result set unprompted.

## Step 3 — Sort, classify, dedup

- **Sort newest-first by `date`** — search results are not strictly chronological.
- **Separate stories from video**: `type === "video"` items have `shareURL: null` and a
  `streams` object; group them under "Videos" rather than mixing them with articles.
- **Dedup** near-identical titles (live coverage often produces several almost-identical
  video entries) on `sophoraId` / title.

## Step 4 — Report coverage

Lead with the volume number, then the freshest hits:

```
Tagesschau coverage of „Bundestag" — 163 Treffer

Neueste Artikel
  • 10.06.  Spitzentreffen mit Sozialpartnern: Kann das Treffen Reformen voranbringen?
            tagesschau.de/inland/…
  • 09.06.  Haushaltsdebatte im Bundestag — …
  …

Videos (3)
  • 08.06.  ARD-Korrespondenten zu … (Video, kein Artikel-Link)

163 Treffer insgesamt · Seite 1 von 7 (25/Seite). Mehr? Sag „nächste Seite".
```

Rules:
- **`totalItemCount` is the headline metric** — "163 Treffer" tells the user how much
  coverage exists; a low number = niche/quiet topic, a high number = major story.
- Show `date` (German `DD.MM.`), `title`, and `shareURL`; flag `null`-URL items as Video.
- State the paging math (page X of N) so the user can ask for more. X is `resultPage + 1`,
  N is `ceil(totalItemCount / pageSize)`.
- For a **timeline** request, bucket the dates (today / this week / older) and report
  counts per bucket to show whether coverage is rising or fading.
- 0 hits → say the term isn't currently covered and suggest a broader synonym; don't
  treat it as an error.
