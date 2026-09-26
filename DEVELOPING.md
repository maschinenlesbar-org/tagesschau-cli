# Developing & integrating

This document covers `tagesschau-cli` as a **TypeScript library**, plus its
architecture, testing and release setup. If you just want to use the
command-line tool, start with the **[README](README.md)** and
**[Usage.md](Usage.md)** instead.

The package ships both a CLI (`tagesschau`) and a typed API client
(`TagesschauClient`) for the open
[Tagesschau API](https://tagesschau.api.bund.dev/)
(`https://www.tagesschau.de/api2u`).

**Design goals**

- **Zero runtime HTTP dependencies** — built on Node's built-in `http`/`https` (no axios, no fetch polyfill).
- **One small dependency** for the CLI: [`commander`](https://github.com/tj/commander.js).
- **Strongly typed** — typed client surface, response envelopes and the Ressort/region enums.
- **Well tested** — unit tests on Node's built-in test runner (`node --test`), every HTTP response mocked.
- **Read-only, no auth** — the Tagesschau API needs no key; this client only reads.

## Build from source

```bash
npm install
npm run build        # compiles TypeScript to dist/
```

Run the locally built CLI without a global install:

```bash
node dist/src/cli/index.js --help
# or, after `npm link`:
tagesschau --help
```

## Library usage

```ts
import { TagesschauClient, TagesschauApiError } from "@maschinenlesbar.org/tagesschau-cli";

const client = new TagesschauClient(); // defaults to https://www.tagesschau.de

const home = await client.homepage();
const econ = await client.news({ ressort: "wirtschaft" });
const hits = await client.search({ searchText: "Wahl", resultPage: 1 }); // 0-based: the second page

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
  timeoutMs: 15_000,          // time limit per request, whole response included; 0 disables it
  maxRetries: 3,              // 429 / 503: waits Retry-After (<= 30 s), else linear backoff
  maxRedirects: 5,            // follow up to N redirects; credential headers are
                              // dropped on cross-origin hops
  maxResponseBytes: 50 << 20, // abort responses larger than this (0 = unlimited;
                              // default is 100 MiB when the option is omitted)
  userAgent: "my-app/1.0",
  transport: customTransport, // inject your own HTTP transport
});
```

The numeric options must be integers in range — `timeoutMs` 0..`MAX_TIMEOUT_MS`,
`maxRetries` 0..`MAX_RETRIES` (10), `retryDelayMs` 0..`MAX_RETRY_AFTER_MS`,
`maxRedirects` 0..`MAX_REDIRECTS` (20), `maxResponseBytes` 0..2^53−1. Anything else
(negative, fractional, `NaN`, `Infinity`) makes the constructor throw a `TagesschauError`
(`Invalid option maxRedirects: expected an integer from 0 to 20, got NaN.`).

### Methods

`client.homepage()`, `client.news({ regions?, ressort?, date? })` (regions or ressort,
not both: together they are rejected with a `TagesschauError` before any request, since
the API would apply the Ressort and silently drop the regions; `date` is the `YYMMDD`
cursor from `nextPage`, checked by the exported `newsDateProblem`), `client.channels()`,
`client.search({ searchText?, pageSize?, resultPage? })`. `RessortValues` and
`RegionValues` are exported for reference.

## Authentication internals

The Tagesschau API is fully open — no API key, no token, no cookie. The client
sends only read-only `GET` requests. The `defaultHeaders` seam in the engine is
present for structural consistency with the library's HTTP engine, but no
credential headers are injected.

**Redirect safety.** When the API issues a redirect that crosses an origin
boundary (different scheme, host, or port), the client **strips credential-bearing
headers** (`Authorization`, `X-API-Key`, `Cookie`) before following it. Same-origin
redirects keep all headers. A same-host `https:` → `http:` **downgrade** counts as
a cross-origin hop (the origin differs by scheme), so credentials are stripped
there too — they never cross the wire in cleartext. The engine also enforces that
a redirect `Location` resolves to an `http:`/`https:` URL, rejecting any other
scheme (e.g. `file:`, `ftp:`, `data:`) as a typed `TagesschauNetworkError` — this
guard lives in the engine, so it holds even when a custom `transport` is injected
that does no scheme checking of its own. The same holds for the configured base
URL: the `RequestEngine` constructor rejects a non-`http(s)` or malformed base URL,
or one with a query or fragment (request paths are appended to it as a string), with a
`TagesschauNetworkError` before any request, and the CLI's `--base-url`
parser (`parseBaseUrl`) already turns one into a usage error at parse time.
Userinfo in the base URL (`https://user:pw@mirror/`) is allowed — Node sends it as
Basic auth — but every error message shows it as `***` (the exported `redactUrl`):
`TagesschauApiError` (message and `url`), the base-URL, redirect and transport URL
errors.

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

### Library / technical terms

**API client.** [`TagesschauClient`](src/client/client.ts) — the typed wrapper
over the API (`homepage()`, `news()`, `channels()`, `search()`). Usable as a
library independently of the CLI.

**Transport.** A single function `(HttpRequest) => Promise<HttpResponse>`
([`http.ts`](src/client/http.ts)). The default uses Node's built-in
`http`/`https`; tests inject a mock. This is the only HTTP seam.

**Request engine.** [`RequestEngine`](src/client/engine.ts) — builds URLs,
serialises queries, applies retry/backoff, follows redirects, decodes JSON and
maps errors. Sits between the client's methods and the transport.

**Query-string builder.** [`query.ts`](src/client/query.ts) — a dependency-free
serialiser: `undefined`/`null` values are omitted, arrays become repeated keys,
booleans become `"true"`/`"false"`, `Date`s become ISO-8601, spaces are encoded
as `%20`.

**CliDeps / CliIO.** The dependency-injection seam for the CLI
([`io.ts`](src/cli/io.ts)): a client factory plus an I/O object (`out`/`err`).
Lets the whole CLI run in tests with a mocked client and captured output — no
subprocess.

**Error types.** [`errors.ts`](src/client/errors.ts): `TagesschauApiError`
(non-2xx, carries `status`/`detail`/`url`/`method`/`body` and an `isRetryable`
flag; `detail` — the body's `detail`, `message` or `error` string — is cleaned for
stderr by `sanitizeServerText`: control and bidi characters dropped, whitespace folded
onto one line, cut at `MAX_DETAIL_LENGTH` (500) characters; `body` keeps the full text), `TagesschauNetworkError` (transport failure/timeout),
`TagesschauParseError` (bad JSON, or a 2xx body without the documented envelope:
`Unexpected response shape from /api2u/news/: expected a JSON object with a "news"
array.` — each method checks its top-level array, `news`/`regional`, `channels`,
`searchResults` and a non-negative `totalItemCount`; items are not checked), all
extending `TagesschauError`. The CLI maps
a `404` to exit code `4`, other errors to `1`.

**Retry / backoff.** Transient `429` (rate limit) and `503` responses are
retried automatically, up to `maxRetries` (default `2`; CLI `--max-retries`,
`0`–`10`). Each retry waits the response's `Retry-After` (`parseRetryAfter`:
delay-seconds or an IMF-fixdate, anything else is ignored) when it is at most
`MAX_RETRY_AFTER_MS` (30 s); a longer one is not retried and the error surfaces
at once. Without a usable header the wait is `retryDelayMs * attempt`.
`TagesschauApiError` exposes `isRetryable` (true for `429`/`503`).

**maxResponseBytes.** A cap on the response body size in bytes (`0` = unlimited;
default 100 MiB), guarding against unbounded responses.

**Rendering (`--compact`).** Every command prints JSON to stdout — pretty-printed
by default, on a single line with `--compact`.

## Testing

```bash
npm test          # builds, then runs `node --test` over dist/test
```

- **`query.test.ts`** — query-string serialisation.
- **`http.test.ts`** — the default transport against a real loopback `http.createServer`.
- **`engine.test.ts`** — URL building, JSON decoding, error mapping, 429/503 retry — mocked transport.
- **`client.test.ts`** — every endpoint's method/URL/query mapping — mocked transport.
- **`cli.test.ts`** — end-to-end command parsing, validation and exit codes — mocked client.
- **`io.test.ts`** — stdout/stderr write errors (a closed pipe exits quietly) — fake streams.

## Continuous integration

GitHub Actions workflows under `.github/workflows/`:

- **ci.yml** — type-check, build and test on Node 20/22/24 for every push and PR.
- **release.yml** — on a `v*` tag: verify the tag matches `package.json`, test, `npm pack`, and create a GitHub Release with the tarball.
- **publish.yml** — manual dispatch: publish to npm via OIDC **Trusted Publishing** (no stored `NPM_TOKEN`) with provenance.
- **docs.yml** — build the project website (`site/`, English and German) with the TypeDoc API docs
  under `/api/`, and deploy both to GitHub Pages on each `v*` tag.
  TypeDoc runs from the isolated, lockfile-pinned `tools/docs/` toolchain because it
  needs the TypeScript 6 compiler API, which TypeScript 7 no longer ships; locally,
  run `npm ci --prefix tools/docs` once before `npm run docs`.

## Website

The project website — <https://maschinenlesbar-org.github.io/tagesschau-cli/> in English and
<https://maschinenlesbar-org.github.io/tagesschau-cli/de/> in German — is built from `site/`
with [Jekyll](https://jekyllrb.com/), [banira](https://sebs.github.io/banira/) web components
and [Fylgja](https://fylgja.dev/) CSS, and deployed by `docs.yml` together with the TypeDoc API
reference under `/api/`. Its content comes from this repository: the README intro and quick
start, the command tree of the built CLI (`site/scripts/cli-reference.mjs`), `Usage.md`,
`GLOSSARY.md` and its German version `GLOSSARY.de.md`, the skills, and the skill examples in
`EXAMPLE.md` and `EXAMPLE.de.md`. The only repo-specific files are `site/_config.yml` and
`site/_data/project.yml` (the German intro and the access requirements); the rest of `site/` is
identical in every maschinenlesbar.org CLI, so change it in all of them together. When the
README intro changes, update the German intro in `site/_data/project.yml`.

```bash
npm run build                        # the CLI, for the command reference
cd site && npm ci && bundle install  # once (Node >= 22.12, Ruby 3.4, Bundler)
npm run serve                        # http://127.0.0.1:4000/tagesschau-cli/
```

## License

Dual-licensed under **[AGPL-3.0-or-later](LICENSE)** or a commercial license — see
**[LICENSING.md](LICENSING.md)**. This project does **not** accept external code
contributions; see **[CONTRIBUTING.md](CONTRIBUTING.md)**.
