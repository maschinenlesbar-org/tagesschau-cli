# tagesschau-cli

[![CI](https://github.com/maschinenlesbar-org/tagesschau-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/maschinenlesbar-org/tagesschau-cli/actions/workflows/ci.yml)
[![Release](https://github.com/maschinenlesbar-org/tagesschau-cli/actions/workflows/release.yml/badge.svg)](https://github.com/maschinenlesbar-org/tagesschau-cli/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/@maschinenlesbar.org/tagesschau-cli)](https://www.npmjs.com/package/@maschinenlesbar.org/tagesschau-cli)

Read German news from your terminal — `tagesschau` is a command-line tool for
ARD-aktuell's open [Tagesschau API](https://tagesschau.api.bund.dev/)
(`tagesschau.de`): browse the curated front page, filter the news feed by topic
or Bundesland, list broadcast channels, and run full-text searches — all as clean
JSON you can pipe straight into [`jq`](https://jqlang.github.io/jq/).

- **Works out of the box** — no account, no API key, no configuration. Install and read.
- **Clean JSON output** — pretty-printed by default, `--compact` for one-line/scripting.
- **Four commands** — `homepage`, `news`, `channels`, `search`.
- **Read-only** — every call is a plain GET; nothing is written, nothing is sent except the query.

> Want to use this as a TypeScript library or understand how it's built?
> See **[DEVELOPING.md](DEVELOPING.md)**.

## Install

```bash
npm i -g @maschinenlesbar.org/tagesschau-cli
```

This installs the **`tagesschau`** command. Requires **Node.js 20+**.

Check it works:

```bash
tagesschau --help
```

## Quickstart

No setup needed — the API is fully open. Your first command:

```bash
tagesschau homepage
```

Pull out just the headlines with `jq`:

```bash
tagesschau homepage | jq -r '.news[].title'
```

## Commands

```text
homepage                                     curated front-page feed (top + regional)
news     [--ressort <r>] [--region <id>…]   news feed, optionally filtered
channels                                     live/broadcast channels
search   <text> [--page-size <n>] [--result-page <n>]   full-text search
```

### `homepage`

No arguments. Returns a JSON object with a `news` array (top stories) and a
`regional` array.

### `news` filters

| Flag | Meaning |
| --- | --- |
| `--ressort <ressort>` | topic: `inland` \| `ausland` \| `wirtschaft` \| `sport` \| `video` \| `investigativ` \| `wissen` |
| `--region <id>` | Bundesland id `1`–`16` (repeatable — pass multiple times to combine) |

Both filters are optional and combinable. The
**[Glossary](GLOSSARY.md)** decodes every term.

### `channels`

No arguments. Returns a `channels` array; each entry carries `title`, `streams`
and image metadata.

### `search` options

| Flag | Meaning |
| --- | --- |
| `--page-size <n>` | results per page (`>= 1`) |
| `--result-page <n>` | page number (`>= 1`, 1-based) |

The positional `<text>` argument is required and must not be empty (rejected
before any request).

## Common tasks

A few recipes to get going — see **[Usage.md](Usage.md)** for the full,
use-case-driven set.

```bash
# Curated front page, headlines only
tagesschau homepage | jq -r '.news[].title'

# Economy news
tagesschau news --ressort wirtschaft

# Regional news for Bayern (9)
tagesschau news --region 9

# Several Bundesländer at once — Berlin (5) and Bayern (9)
tagesschau news --region 5 --region 9

# Full-text search
tagesschau search "Bundestag"

# Page through search results (1-based)
tagesschau search "Wahl" --page-size 20 --result-page 2

# List live channel titles
tagesschau channels | jq -r '.channels[].title'
```

## Output & scripting

Every command prints **pretty JSON to stdout**. Errors and diagnostics go to
stderr, so piping stdout into `jq` stays clean.

```bash
# Date + topic + title digest from the front page
tagesschau homepage | jq -r '.news[] | "\(.date[0:10])  [\(.ressort)]  \(.title)"'

# Count search hits
tagesschau search "Bundestag" | jq '.totalItemCount'

# Titles from a search
tagesschau search "Bundestag" | jq -r '.searchResults[].title'
```

Use `--compact` for single-line JSON in pipelines and logs:

```bash
tagesschau --compact homepage | jq -c '.news'
```

`--compact` is a global option and works **before or after** the command name.

**Exit codes** make the CLI easy to use in scripts:

| Code | Meaning |
| --- | --- |
| `0` | success (also `--help` / `--version`) |
| `4` | resource not found (`404`) |
| `1` | any other error (API error, network failure, unexpected) |
| non-zero | usage / invalid argument (commander parse error) |

## Troubleshooting

- **`command not found: tagesschau`** — the global npm bin directory isn't on
  your `PATH`. Run `npm bin -g` to find it and add it, or run via
  `npx @maschinenlesbar.org/tagesschau-cli …`.
- **Exit `4` / "not found"** — the API returned a `404`. Check that any region
  id is in the range `1`–`16` and that the search text isn't empty.
- **Network error / timeout** — connectivity or a timeout. Try again, or raise
  the limit with `--timeout 60000`.
- **No results / empty arrays** — the query matched nothing; broaden the search
  text, drop `--ressort`/`--region` filters, or try a different keyword.
- **Invalid ressort** — must be one of `inland`, `ausland`, `wirtschaft`,
  `sport`, `video`, `investigativ`, `wissen` (exact lowercase string).
- **`--page-size` / `--result-page` rejected** — both must be integers `>= 1`;
  the API's paging is 1-based and does not accept `0`.

## Global options

These apply to every command and may be given **before or after** the command name:

| Option | Description |
| --- | --- |
| `-V, --version` | Print the version number |
| `-h, --help` | Show help for the program or a command |
| `--compact` | Print JSON on a single line instead of pretty-printed |
| `--base-url <url>` | API base URL (default `https://www.tagesschau.de`) |
| `--timeout <ms>` | Per-request timeout in milliseconds (default `30000`; `0` disables) |
| `--user-agent <ua>` | `User-Agent` header value |
| `--max-retries <n>` | Retries for transient `429`/`503` responses (default `2`) |
| `--max-redirects <n>` | Max HTTP redirects to follow (default `5`) |
| `--max-response-bytes <n>` | Cap response body size in bytes (`0` = unlimited; default 100 MiB) |

## Learn more

- **[Usage.md](Usage.md)** — full use-case-driven cookbook.
- **[GLOSSARY.md](GLOSSARY.md)** — every command, flag and domain term explained.
- **[DEVELOPING.md](DEVELOPING.md)** — TypeScript library usage, architecture, testing, CI.

## License

**Dual-licensed** — use it under **either**:

- **[AGPL-3.0-or-later](LICENSE)** (default, free). Note the AGPL's §13 network
  clause: if you run a modified version as a network service, you must offer that
  modified source to the service's users.
- **Commercial license** (paid), for closed-source / proprietary or SaaS use
  without the AGPL's obligations.

See **[LICENSING.md](LICENSING.md)** for details, and **[CONTRIBUTING.md](CONTRIBUTING.md)**
for the contribution policy (this project does not accept external code
contributions). Commercial enquiries: **sebs@2xs.org**.
