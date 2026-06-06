# tagesschau-cli — exploratory test findings

Environment: 2026-06-06, Node v22.14.0, live Tagesschau API reachable. Binary driven as `node dist/src/cli/index.js …` after `npm run build`. Exit codes captured without a pipe (a trailing `| head` masks `$?`).

**14 genuine, reproducible bugs** (1 High, 7 Medium, 6 Low). This is a small 4-command CLI; after thorough probing I did not reach 20 without padding, so I report only what reproduces. Verified-correct behaviours are listed at the end so the negatives stand out.

Root cause of most numeric findings: `parseIntArg` in `src/cli/shared.ts` validates with bare `Number(value)` + `Number.isInteger(n) && n >= 0`, which accepts hex/exponent/whitespace/empty/unsafe-magnitude inputs and silently coerces them; and the engine treats `0` as "disabled" for timeout / max-response-bytes, so an empty value removes a protection rather than erroring.

## High

### 1. `--max-redirects ""` (empty/unset var) silently breaks `homepage`
- Severity: High · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js --max-redirects "" homepage`
- Expected: empty value rejected, or treated as the default (5); `homepage` works (it 308-redirects `/homepage/`→`/homepage`).
- Actual: `exit=1  Error: Too many redirects (>0) for GET https://www.tagesschau.de/api2u/homepage/` — `""`→`0` disables redirect-following, so the flagship command fails with a misleading message. A script doing `--max-redirects "$N"` with `N` unset breaks silently.
- Root cause: `parseIntArg` (`src/cli/shared.ts`) `Number("")===0`; engine treats 0 as "no redirects".

## Medium

### 2. `--max-response-bytes ""` silently DISABLES the response-size cap
- Severity: Medium · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js --max-response-bytes "" channels`
- Expected: empty rejected.
- Actual: `exit=0`, request succeeds with the memory-exhaustion guard turned off (`0` = unlimited). A quoting accident removes a safety control.
- Root cause: `parseIntArg` `""`→0; engine `maxResponseBytes>0 ? cap : none`.

### 3. `--timeout ""` silently disables the request timeout
- Severity: Medium · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js --timeout "" channels` → `exit=0` (no timeout applied; `0` disables it).
- Root cause: same `parseIntArg`/`0`-means-off pair.

### 4. Numeric flags accept hexadecimal
- Severity: Medium · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js --compact search Wahl --page-size 0x10`
- Actual: sent as `pageSize=16` (`…"pageSize":16…`), exit 0 — a value the user never typed, despite the help text "Expected a non-negative integer."
- Root cause: `Number("0x10")===16` passes `Number.isInteger`.

### 5. Numeric flags accept exponent notation
- Severity: Medium · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js search Wahl --result-page 1e3` → accepted (exit 0), becomes 1000.

### 6. Numeric flags accept whitespace-padded values
- Severity: Medium · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js --timeout " 5 " homepage` → `Error: Request timed out after 5ms` (the `" 5 "` was coerced to 5 rather than rejected).

### 7. Numeric flags accept unsafe-magnitude integers (precision loss)
- Severity: Medium · Confidence: Likely
- Repro: `node dist/src/cli/index.js search Wahl --page-size 99999999999999999999` → accepted with no error; `Number()` yields `1e20`, which serialises into the query as `100000000000000000000` — a different value than typed. (Same `parseIntArg` root cause as #4–6; the live response did not echo the field back so the transmitted value wasn't directly observed.)

### 8. Empty search text is sent as `searchText=` → server 400, no client guard
- Severity: Medium · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js search ""`
- Actual: `exit=1  Error: HTTP 400 for GET https://www.tagesschau.de/api2u/search/?searchText=` — the empty query is forwarded verbatim and the raw upstream 400 is surfaced, rather than omitting the param or validating client-side.

## Low

### 9. No-args prints usage to stderr and exits 1
- Severity: Low · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js` → `exit=1`, "Usage: …" on stderr. Conventionally a bare invocation shows help on stdout with exit 0 (as `--help` does). Inconsistent with `--help`.

### 10. `--base-url ""` yields a confusing "Invalid URL" message
- Severity: Low · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js --base-url "" homepage` → `Error: Invalid URL: /api2u/homepage/`. An empty base-url isn't guarded by the `?? default` (only `undefined` is), so the path is used as a whole URL. A clearer "base URL must not be empty" would help.

### 11. Connection-refused surfaced as a raw Node error string
- Severity: Low · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js --base-url http://127.0.0.1:1 homepage` → `Error: connect ECONNREFUSED 127.0.0.1:1` (raw `node:net` message rather than a wrapped/branded network error). Exit 1 is correct; only the message is unpolished.

### 12. `--result-page` / `--page-size` documented range (1–30) not enforced
- Severity: Low · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js --compact search Wahl --result-page 0` (and `--result-page 1e3`) → accepted, exit 0. Help/spec describe a 1–30 bound that is never checked.

### 13. Error message contradicts accepted input
- Severity: Low · Confidence: Confirmed
- The `parseIntArg` error reads "Expected a non-negative integer," yet `0x10`, `1e3`, and `" 5 "` are all accepted (see #4–6). Negative values (`-5`) and `abc` are correctly rejected — so the message is only half-true.

### 14. `--user-agent ""` is accepted (likely sends an empty UA header)
- Severity: Low · Confidence: Likely
- Repro: `node dist/src/cli/index.js --user-agent "" channels` → exit 0. Empty isn't guarded by `?? DEFAULT_USER_AGENT` (only `undefined` is), so an empty `User-Agent:` header is sent. The API tolerates it here, but some hosts reject blank UAs.

## Verified correct (not bugs)
- `--ressort` and `--region` reject invalid/out-of-range/`"1,2"` values with clear messages and exit 1.
- Negative numeric values (`--page-size -5`, `--result-page -1`) are rejected by commander.
- Extra positionals (`search a b`, `homepage extra`, `news foo`) are rejected.
- `homepage` works via redirect-following; `channels`/`news`/`search` return data; German umlauts are emitted raw (not `\uXXXX`) in both compact and pretty output; compact ends with exactly one `\n`.
- `--timeout 1` → "Request timed out after 1ms"; `--max-response-bytes 1` → "Response exceeded maxResponseBytes (1)"; both exit 1.
- README has no stale `-o/--output`; `--max-redirects` is documented including the cross-origin credential-stripping behaviour.

**Count: 14 real bugs (1 High, 7 Medium, 6 Low).**
