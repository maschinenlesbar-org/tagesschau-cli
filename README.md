# tagesschau-cli

A TypeScript **API client** and **command-line interface** for the open
[Tagesschau API](https://tagesschau.api.bund.dev/) (`tagesschau.de`) — ARD-aktuell's
structured German news feed: **homepage**, **news by region/Ressort**, **channels**
and **full-text search**.

- **Zero runtime HTTP dependencies** — built on Node's built-in `http`/`https` (no axios, no fetch polyfill).
- **One small dependency** for the CLI: [`commander`](https://github.com/tj/commander.js).
- **Strongly typed** — typed client surface, response envelopes and the Ressort/region enums.
- **Well tested** — unit tests on Node's built-in test runner (`node --test`), every HTTP response mocked.
- **Read-only, no auth** — the Tagesschau API needs no key; this client only reads.

## Requirements

- Node.js **>= 20** (uses the stable built-in test runner, ESM and top-level `await`).

## Install

```bash
npm install
npm run build        # compiles TypeScript to dist/
```

Run the CLI without a global install:

```bash
node dist/src/cli/index.js --help
# or, after `npm link` / global install:
tagesschau --help
```

---

## CLI usage

Every command prints pretty JSON to stdout (`--compact` for a single line).

### Global options

| Option | Description |
| --- | --- |
| `--base-url <url>` | API base URL (default `https://www.tagesschau.de`) |
| `--timeout <ms>` | Per-request timeout (default `30000`; `0` disables the timeout) |
| `--user-agent <ua>` | `User-Agent` header value |
| `--max-retries <n>` | Retries for transient `429`/`503` responses (default `2`) |
| `--max-redirects <n>` | Max HTTP redirects to follow (default `5`). Same-origin redirects are followed transparently; on a cross-origin hop credential headers (`Authorization`, `X-API-Key`, `Cookie`) are stripped before the next request. Exhausting the limit raises a clear "too many redirects" error. |
| `--max-response-bytes <n>` | Cap response body size in bytes (`0` = unlimited; default 100 MiB) |
| `--compact` | Print JSON on a single line |

Global options go **before** the command, e.g. `tagesschau --compact homepage`.

### Commands

```text
homepage                         curated homepage feed (top + regional)
news [--ressort <r>] [--region <id> ...]    news feed
     ressort: inland | ausland | wirtschaft | sport | video | investigativ | wissen
     region:  Bundesland id 1..16 (repeatable)
channels                         live/broadcast channels
search <text> [--page-size <n>] [--result-page <n>]   full-text search
```

### Examples

```bash
# Top stories
tagesschau homepage

# Economy news
tagesschau news --ressort wirtschaft

# Regional news for Bayern (9) and Berlin (5)
tagesschau news --region 9 --region 5

# Search
tagesschau search "Bundestag" --result-page 1
```

Exit codes: `0` success, `4` on a `404` from the API, `1` for any other error, non-zero for usage errors.

---

## Library usage

```ts
import { TagesschauClient, TagesschauApiError } from "tagesschau-cli";

const client = new TagesschauClient(); // defaults to https://www.tagesschau.de

const home = await client.homepage();
const econ = await client.news({ ressort: "wirtschaft" });
const hits = await client.search({ searchText: "Wahl", resultPage: 1 });

try {
  // An empty searchText is sent to the API as-is (not rejected client-side); the
  // API may answer with a non-2xx, which surfaces as a TagesschauApiError.
  await client.search({ searchText: "" });
} catch (err) {
  if (err instanceof TagesschauApiError) console.error(err.status, err.detail);
}
```

### Client options

```ts
new TagesschauClient({
  baseUrl: "https://www.tagesschau.de",
  timeoutMs: 15_000,          // 0 disables the per-request timeout
  maxRetries: 3,              // 429 / 503 are retried with linear backoff
  maxRedirects: 5,            // follow up to N redirects; credential headers are
                              // dropped on cross-origin hops
  maxResponseBytes: 50 << 20, // abort responses larger than 50 MiB (0 = unlimited)
  userAgent: "my-app/1.0",
  transport: customTransport, // inject your own HTTP transport
});
```

### Methods

`client.homepage()`, `client.news({ regions?, ressort? })`, `client.channels()`,
`client.search({ searchText?, pageSize?, resultPage? })`. `RessortValues` and
`RegionValues` are exported for reference.

---

## Architecture

```
src/
  client/
    enums.ts     # Ressort + region (1..16) value sets (runtime + type)
    types.ts     # response envelopes (items exposed as raw JsonObject)
    query.ts     # dependency-free query-string builder
    http.ts      # the Transport interface + default node:http/https transport
    engine.ts    # URL building, retry/backoff, JSON/raw decoding, error mapping
    errors.ts    # TagesschauError / *ApiError / *NetworkError / *ParseError
    client.ts    # TagesschauClient — the news surface over the engine
  cli/
    io.ts        # injectable I/O seam (stdout/stderr/file)
    shared.ts    # option parsers, global-option resolver, JSON renderer
    commands/    # homepage / news / channels / search
    program.ts   # assembles the commander program from injectable deps
    run.ts       # parses argv -> exit code (no process.exit; testable)
    index.ts     # #! bin shim
```

**Design notes**

- The HTTP layer is a single `Transport` function (`(req) => Promise<HttpResponse>`). The default
  uses `node:http`/`node:https`; tests inject a mock. This keeps the client free of any HTTP framework.
- The CLI is built around injectable `CliDeps` (client factory + I/O), so the whole program can be
  driven in-process by tests with a mocked client and captured output — no subprocesses.
- News items are deeply nested and vary by type, so they are returned as faithful raw `JsonObject`s
  rather than partially-guessed types.

---

## Testing

```bash
npm test          # builds, then runs `node --test` over dist/test
```

- **`query.test.ts`** — query-string serialisation.
- **`http.test.ts`** — the default transport against a real loopback `http.createServer`.
- **`engine.test.ts`** — URL building, JSON decoding, error mapping, 429/503 retry — mocked transport.
- **`client.test.ts`** — every endpoint's method/URL/query mapping — mocked transport.
- **`cli.test.ts`** — end-to-end command parsing, validation and exit codes — mocked client.

## Continuous integration

GitHub Actions workflows under `.github/workflows/`:

- **ci.yml** — type-check, build and test on Node 20/22/24 for every push and PR.
- **release.yml** — on a `v*` tag: verify the tag matches `package.json`, test, `npm pack`, and create a GitHub Release with the tarball.
- **publish.yml** — manual dispatch: publish to npm via OIDC **Trusted Publishing** (no stored `NPM_TOKEN`) with provenance.
- **docs.yml** — build TypeDoc API docs and deploy to GitHub Pages on each `v*` tag.

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
