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

## Authentication internals

The Tagesschau API is fully open — no API key, no token, no cookie. The client
sends only read-only `GET` requests. The `defaultHeaders` seam in the engine is
present for structural consistency with the library's HTTP engine, but no
credential headers are injected.

**Redirect safety.** When the API issues a redirect that crosses an origin
boundary (different scheme, host, or port), the client **strips credential-bearing
headers** (`Authorization`, `X-API-Key`, `Cookie`) before following it. Same-origin
redirects keep all headers.

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
flag), `TagesschauNetworkError` (transport failure/timeout),
`TagesschauParseError` (bad JSON), all extending `TagesschauError`. The CLI maps
a `404` to exit code `4`, other errors to `1`.

**Retry / backoff.** Transient `429` (rate limit) and `503` responses are
retried automatically with backoff, up to `--max-retries`. `TagesschauApiError`
exposes `isRetryable` (true for `429`/`503`).

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

## Continuous integration

GitHub Actions workflows under `.github/workflows/`:

- **ci.yml** — type-check, build and test on Node 20/22/24 for every push and PR.
- **release.yml** — on a `v*` tag: verify the tag matches `package.json`, test, `npm pack`, and create a GitHub Release with the tarball.
- **publish.yml** — manual dispatch: publish to npm via OIDC **Trusted Publishing** (no stored `NPM_TOKEN`) with provenance.
- **docs.yml** — build TypeDoc API docs and deploy to GitHub Pages on each `v*` tag.

## License

Dual-licensed under **[AGPL-3.0-or-later](LICENSE)** or a commercial license — see
**[LICENSING.md](LICENSING.md)**. This project does **not** accept external code
contributions; see **[CONTRIBUTING.md](CONTRIBUTING.md)**.
