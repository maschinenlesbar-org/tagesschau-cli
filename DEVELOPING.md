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
import {
  TagesschauClient,
  TagesschauApiError,
  TagesschauValidationError,
} from "@maschinenlesbar.org/tagesschau-cli";

const client = new TagesschauClient(); // defaults to https://www.tagesschau.de

const home = await client.homepage();
const econ = await client.news({ ressort: "wirtschaft" });
const hits = await client.search({ searchText: "Wahl", resultPage: 1 }); // 0-based: the second page

try {
  // A blank searchText is rejected before any request (searchTextProblem).
  await client.search({ searchText: "  " });
} catch (err) {
  if (err instanceof TagesschauValidationError) console.error(err.message); // search text must not be empty.
  else if (err instanceof TagesschauApiError) console.error(err.status, err.detail);
}
```

### Client options

```ts
new TagesschauClient({
  baseUrl: "https://www.tagesschau.de",
  timeoutMs: 15_000,          // time limit per request, whole response included; 0 disables it
  maxRetries: 3,              // 429 / 503: linear backoff, or Retry-After when longer (<= 30 s)
  maxRedirects: 5,            // follow up to N redirects; credential headers are
                              // dropped on cross-origin hops
  maxResponseBytes: 50 << 20, // abort responses larger than this (0 = unlimited;
                              // default is 100 MiB when the option is omitted)
  userAgent: "my-app/1.0",    // default "tagesschau-cli" when omitted; a blank one is an error
  transport: customTransport, // inject your own HTTP transport
});
```

The numeric options must be integers in range — `timeoutMs` 0..`MAX_TIMEOUT_MS`,
`maxRetries` 0..`MAX_RETRIES` (10), `retryDelayMs` 0..`MAX_RETRY_AFTER_MS`,
`maxRedirects` 0..`MAX_REDIRECTS` (20), `maxResponseBytes` 0..2^53−1. Anything else
(negative, fractional, `NaN`, `Infinity`) makes the constructor throw a `TagesschauError`
(`Invalid option maxRedirects: expected an integer from 0 to 20, got NaN.`).
`userAgent` must be a non-blank Latin-1 string without control characters (tab is
allowed); only an omitted one selects the default `tagesschau-cli`. A blank one, a
CR/LF or other control character, or a character above U+00FF makes the constructor
throw a `TagesschauValidationError` (`Invalid userAgent: Expected a non-empty value.`).
The rule is the exported `headerValueProblem` / `assertHeaderValue`, which the CLI's
`--user-agent` parser calls too.

### Methods

`client.homepage()`, `client.news({ regions?, ressort?, date? })` (regions or ressort,
not both: together they are rejected with a `TagesschauError` before any request, since
the API would apply the Ressort and silently drop the regions; each region must be one
of `RegionValues` and the ressort one of `RessortValues`, exactly as written there —
anything else, blank, padded or wrong-case included, is a `TagesschauValidationError`
before any request, checked by the exported `regionProblem` / `ressortProblem`; `date`
is the `YYMMDD` cursor from `nextPage`, checked by the exported `newsDateProblem`),
`client.channels()`,
`client.search({ searchText, pageSize?, resultPage? })` (`searchText` is required; a
blank one is rejected with a `TagesschauValidationError` before any request, checked by
the exported `searchTextProblem` after NFKC normalisation; so is a `pageSize` that is not
an integer in 1..`MAX_SEARCH_INT` (2147483647, a 32-bit int upstream) or a `resultPage`
that is not one in 0..`MAX_SEARCH_INT` — `Invalid pageSize: expected an integer from 1 to
2147483647, got 0.` — checked by the exported `pageSizeProblem` / `resultPageProblem`). `RessortValues` and
`RegionValues` are exported; they are the allow-lists `news()` checks.

## Authentication internals

The Tagesschau API is fully open — no API key, no token, no cookie. The client
sends only read-only `GET` requests with two headers, `Accept` and `User-Agent`;
there is no seam for extra headers and no credential header is ever injected.

**Redirect safety.** Userinfo in the base URL is not handed to the transport in
the URL: the engine sends it as an `Authorization: Basic …` header it manages per
hop. When the API issues a redirect that crosses an origin
boundary (different scheme, host, or port), the client **strips credential-bearing
headers** (`Authorization`, `X-API-Key`, `Cookie`) before following it, and a 401/403
from the target then names the drop (`the server redirected http→https, which dropped
the base URL's credentials; use an https base URL`). Same-origin redirects keep all
headers, whether the `Location` is relative or absolute; a `Location`'s own userinfo
is ignored. The engine follows redirects itself: `HttpRequest.redirect` is `"manual"`,
and a response whose `HttpResponse.url` (fetch's `response.url`) lies on another origin
is rejected as a `TagesschauNetworkError` ("the transport followed a redirect to
another origin"). `test/conformance-p3-redirect-credentials.test.ts` checks it. A same-host `https:` → `http:` **downgrade** counts as
a cross-origin hop (the origin differs by scheme), so credentials are stripped
there too — they never cross the wire in cleartext. The engine also enforces that
a redirect `Location` resolves to an `http:`/`https:` URL, rejecting any other
scheme (e.g. `file:`, `ftp:`, `data:`) as a typed `TagesschauNetworkError` — this
guard lives in the engine, so it holds even when a custom `transport` is injected
that does no scheme checking of its own. The same holds for the configured base
URL: the `RequestEngine` constructor runs the exported `validateBaseUrl` on the raw
value, before the trailing-slash strip, and rejects a blank, non-`http(s)` or malformed
base URL, one with surrounding or inner whitespace or a control character, or one with a
query or fragment (request paths are appended to it as a string), or a `%` in the user
name or password that doesn't start an escape (write a literal `%` as `%25`; it is
decoded for the Authorization header and would otherwise fail at request time), with a
`TagesschauValidationError` before any request (`Invalid baseUrl: Unsupported scheme
"ftp:". Expected an http(s) URL.`). It is a configuration error, not a transport
failure, so it is not a `TagesschauNetworkError`; that class stays for the default
transport's per-hop scheme check and for redirect targets. Whitespace matters because
`new URL()` would trim it silently while the raw string is what each path is appended
to: `"https://h/ "` would request `/%20/api2u/...`. The rules are the exported
`baseUrlProblem` (and its part `baseUrlWhitespaceProblem`); the CLI's `--base-url`
parser (`parseBaseUrl`) calls the same `baseUrlProblem` and turns its reason into a
usage error at parse time, with no rules of its own.
Userinfo in the base URL (`https://user:pw@mirror/`) is allowed — the engine sends it
as Basic auth (see above), and request URLs in errors carry none — and any text that
still shows it shows it as `***` (the exported `redactUrl`):
`TagesschauApiError` (message and `url`), the redirect and transport URL errors; the
base-URL errors never echo the URL at all. The CLI also redacts on output: `run.ts`
(`withRedactedOutput`) takes the exact userinfo of every argument (`credentialsIn`,
exported) and replaces it with `***` in everything it prints — commander's usage errors,
which echo a rejected `--base-url` value, a mistyped option name in `=` form
(`--base-ur=…`) or a URL typed without the flag (`unknown command '…'`), and the
library's messages that name a rejected region or date — so a password with spaces,
quotes, `#`, `?` or `/` is caught as well as an ordinary one. `redactUrl` (exported)
falls back to the same text-based cut (`redactCredentials`) for a value that doesn't
parse as a URL. Logging a client shows no base URL: the engine keeps it in a real
`#private` field, so `console.log(client)`, `util.inspect` and `JSON.stringify` don't
reach it. The engine also scrubs the base URL's userinfo (raw and percent-decoded) from
error bodies and details, from transport error text and from the `cause` chain, and
wraps whatever a custom transport throws in a `TagesschauNetworkError` (the original,
scrubbed, as `cause`); `test/conformance-p2-library-redaction.test.ts` checks it. `test/conformance-p1-cli-redaction.test.ts` checks ten passwords, seven
URL shapes and every echo path.

## Architecture

```
src/
  client/
    enums.ts     # Ressort + region (1..16) value sets (runtime + type)
    types.ts     # response envelopes (items exposed as raw JsonObject)
    query.ts     # dependency-free query-string builder
    http.ts      # the Transport interface + default node:http/https transport
    engine.ts    # URL building, retry/backoff, JSON/raw decoding, error mapping
    errors.ts    # TagesschauError / *ApiError / *NetworkError / *ParseError / *ValidationError
    validate.ts  # the Problem type + assertValid: input rules shared by library and CLI
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
`http`/`https`; tests inject a mock. This is the only HTTP seam. The engine enforces
the transport contract itself, so the documented limits hold for a custom transport
(`fetch`, a `node:http` wrapper) too: it races every call against the `timeoutMs`
deadline and aborts the request's `signal` then (the built-in transport honours it;
pass it on as `fetch(url, { signal })`), checks the body against `maxResponseBytes`,
reads response headers in any case and from a `Headers` object or a `Map`, accepts any
ArrayBuffer view (a `Uint8Array` from `fetch`) or ArrayBuffer as the body, and turns a
thrown value or a malformed response (no status, no headers, a body of another type)
into a `TagesschauNetworkError`. `test/conformance-p5-transport-contract.test.ts` checks it.

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
`searchResults` and a non-negative `totalItemCount`; items are not checked) and
`TagesschauValidationError` (a rejected input, thrown before any request), all
extending `TagesschauError`. The CLI maps
a `404` to exit code `4`, other errors to `1`.

**Input validation.** The library owns every rule about what a request may contain;
the CLI calls the same functions instead of keeping its own copy. A rule is a pure,
exported `Problem` ([`validate.ts`](src/client/validate.ts)): it returns the reason a
value is invalid, or `undefined`. The library enforces it with
`assertValid(name, value, problem)`, which throws `TagesschauValidationError` with the
message `Invalid <name>: <reason>` before any request (a constructor throws; a method
returning a promise rejects). The CLI's commander parsers turn the same reason into a
usage error (exit 1), and `run.ts` maps a `TagesschauValidationError` raised during an
action to exit 1 too, printed as `Error: <message>`.

**Retry / backoff.** Transient `429` (rate limit) and `503` responses are
retried automatically (transport failures — a refused or reset connection, a DNS
failure, a timeout — are not: with 60 requests an hour, a broken connection is
reported, not asked again at once), up to `maxRetries` (default `2`; CLI `--max-retries`,
`0`–`10`). Each retry waits `retryDelayMs * attempt` (200 ms, 400 ms, …), or the
response's `Retry-After` (`parseRetryAfter`: delay-seconds or an IMF-fixdate, anything
else is ignored) when that is longer: the header can lengthen a wait, never shorten it,
so `Retry-After: 0` or a past date doesn't make a burst. A `Retry-After` above
`MAX_RETRY_AFTER_MS` (30 s) is not retried: the error surfaces at once and says so
(`HTTP 429 for GET …: the server asked to retry after 100 s, longer than the 30 s the
client waits; not retried — try again after that`; `retryAfterMs` holds the wait).
After spent retries the message ends `(after 2 retries)` and `retries` holds the count.
`TagesschauApiError` exposes `isRetryable` (true for `429`/`503`).

**maxResponseBytes.** A cap on the response body size in bytes (`0` = unlimited;
default 100 MiB), guarding against unbounded responses. The built-in transport aborts
as soon as the cap is passed; the engine checks the body of any transport. The error
names both spellings: `Response exceeded the size limit of 1000 bytes
(maxResponseBytes; --max-response-bytes on the CLI)`.

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
- **`validate.test.ts`** — `assertValid`, the `run.ts` mapping of
  `TagesschauValidationError`, and the `parity()` helper (`test/helpers.ts`), which sends
  one input through `run()` and through the library on one recording mock transport so
  a test can assert both give the same outcome.

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
