# Usage

Practical, use-case-driven examples for the **Tagesschau CLI** — a read-only
command-line client for ARD-aktuell's open [Tagesschau API](https://tagesschau.api.bund.dev/)
(`tagesschau.de`). Every command prints JSON to stdout, so it pairs naturally
with [`jq`](https://jqlang.github.io/jq/).

## Install

```bash
npm i -g @maschinenlesbar.org/tagesschau-cli
```

This installs the `tagesschau` binary. To run from a checkout without a global
install, use `node dist/src/cli/index.js` in place of `tagesschau` (after
`npm run build`).

```bash
tagesschau --help
```

The API needs no key or token — it is fully open and read-only.

## Use cases

### 1. Read the curated front page

Why: get the same editorially-selected top stories that lead `tagesschau.de`.

```bash
tagesschau homepage
```

The result has a `news` array (the main feed) and a `regional` array. To pull
just the headlines:

```bash
tagesschau homepage | jq -r '.news[].title'
```

### 2. Skim headlines with their topline and timestamp

Why: a compact "what's happening now" digest instead of the full JSON.

```bash
tagesschau homepage | jq -r '.news[] | "\(.date[0:10])  [\(.ressort)]  \(.title)"'
```

Each news item carries `title`, `topline`, `firstSentence`, `date`, `ressort`
and `shareURL`, so you can shape the line however you like.

### 3. Filter the news feed by Ressort

Why: read only one department — e.g. business or sport.

```bash
# Economy
tagesschau news --ressort wirtschaft

# Sport
tagesschau news --ressort sport
```

Valid Ressorts: `inland`, `ausland`, `wirtschaft`, `sport`, `video`,
`investigativ`, `wissen`. The news feed returns `news`, `regional` and (when
there are more results) a `nextPage` cursor URL.

### 4. Get regional news for one Bundesland

Why: focus on a single federal state by its numeric region id (`1`–`16`).
When you filter by `--region`, the matching items come back in the `news`
array (each tagged with the requested `regionId`); the top-level `regional`
array is only populated on the unfiltered `homepage` feed.

```bash
# Bayern (region id 9)
tagesschau news --region 9 | jq -r '.news[].title'
```

### 5. Regional news across several Bundesländer

Why: watch a few states at once. `--region` is repeatable; the client joins the
ids into a single comma-separated `regions` query (e.g. `regions=5,9`).

```bash
# Berlin (5) and Bayern (9)
tagesschau news --region 5 --region 9
```

### 6. Combine a Ressort with regions

Why: e.g. domestic-politics news scoped to specific states.

```bash
tagesschau news --ressort inland --region 5 --region 9 \
  | jq -r '.news[].title'
```

### 7. Full-text search across articles

Why: find coverage of a topic by keyword.

```bash
tagesschau search "Bundestag"
```

The result includes `searchResults`, `totalItemCount`, and the echoed
`searchText`/`pageSize`/`resultPage`. Count the hits and list titles:

```bash
tagesschau search "Bundestag" | jq '.totalItemCount'
tagesschau search "Bundestag" | jq -r '.searchResults[].title'
```

An empty search text is rejected by the CLI before any request is made.

### 8. Page through search results

Why: walk large result sets. Both paging parameters are **1-based** (`>= 1`).

```bash
# 20 results per page, second page
tagesschau search "Wahl" --page-size 20 --result-page 2
```

### 9. List the live / broadcast channels

Why: discover the linear and streaming programme feeds and their stream URLs.

```bash
tagesschau channels | jq -r '.channels[].title'
```

Each channel exposes `title`, `streams` and image/copyright metadata.

### 10. Machine-friendly, single-line output

Why: feed downstream tooling or log a compact record.

```bash
tagesschau --compact homepage
```

`--compact` is a global option, so it goes **before** the command.

## Global options

These apply to every command and must appear **before** the command name
(e.g. `tagesschau --compact news --ressort sport`).

| Option | Description |
| --- | --- |
| `-V, --version` | Print the version and exit. |
| `--base-url <url>` | API base URL (default `https://www.tagesschau.de`). |
| `--timeout <ms>` | Per-request timeout in milliseconds. |
| `--user-agent <ua>` | `User-Agent` header value. |
| `--max-retries <n>` | Retries for transient `429`/`503` responses (default `2`). |
| `--max-redirects <n>` | Max HTTP redirects to follow (default `5`; credential headers are dropped on cross-origin hops). |
| `--max-response-bytes <n>` | Cap response body size in bytes (`0` = unlimited; default 100 MiB). |
| `--compact` | Print JSON on a single line instead of pretty-printed. |
| `-h, --help` | Display help for the program or a command. |

Exit codes: `0` success, `4` on a `404` from the API, `1` for any other error,
and a non-zero usage error from the parser for invalid arguments.
