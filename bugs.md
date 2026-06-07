# tagesschau-cli — exploratory test findings

Environment: 2026-06-06, Node v22.14.0, live Tagesschau API reachable. Binary driven as `node dist/src/cli/index.js …` after `npm run build`. Exit codes captured without a pipe (a trailing `| head` masks `$?`).

**14 genuine, reproducible bugs** (1 High, 7 Medium, 6 Low). This is a small 4-command CLI; after thorough probing I did not reach 20 without padding, so I report only what reproduces. Verified-correct behaviours are listed at the end so the negatives stand out.

Root cause of most numeric findings: `parseIntArg` in `src/cli/shared.ts` validates with bare `Number(value)` + `Number.isInteger(n) && n >= 0`, which accepts hex/exponent/whitespace/empty/unsafe-magnitude inputs and silently coerces them; and the engine treats `0` as "disabled" for timeout / max-response-bytes, so an empty value removes a protection rather than erroring.

## High

### 1. `--max-redirects ""` (empty/unset var) silently breaks `homepage` — ✅ FIXED
**Fix:** `parseIntArg` in `src/cli/shared.ts` now requires a `^[0-9]+$` decimal literal, so `""` is rejected by commander before the engine sees it (no more `0`-means-disabled coercion).
- Severity: High · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js --max-redirects "" homepage`
- Expected: empty value rejected, or treated as the default (5); `homepage` works (it 308-redirects `/homepage/`→`/homepage`).
- Actual: `exit=1  Error: Too many redirects (>0) for GET https://www.tagesschau.de/api2u/homepage/` — `""`→`0` disables redirect-following, so the flagship command fails with a misleading message. A script doing `--max-redirects "$N"` with `N` unset breaks silently.
- Root cause: `parseIntArg` (`src/cli/shared.ts`) `Number("")===0`; engine treats 0 as "no redirects".

## Medium

### 2. `--max-response-bytes ""` silently DISABLES the response-size cap — ✅ FIXED
**Fix:** Same `parseIntArg` tightening in `src/cli/shared.ts`; `""` is now rejected instead of coercing to `0`.
- Severity: Medium · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js --max-response-bytes "" channels`
- Expected: empty rejected.
- Actual: `exit=0`, request succeeds with the memory-exhaustion guard turned off (`0` = unlimited). A quoting accident removes a safety control.
- Root cause: `parseIntArg` `""`→0; engine `maxResponseBytes>0 ? cap : none`.

### 3. `--timeout ""` silently disables the request timeout — ✅ FIXED
**Fix:** Same `parseIntArg` tightening in `src/cli/shared.ts`; `""` rejected.
- Severity: Medium · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js --timeout "" channels` → `exit=0` (no timeout applied; `0` disables it).
- Root cause: same `parseIntArg`/`0`-means-off pair.

### 4. Numeric flags accept hexadecimal — ✅ FIXED
**Fix:** `parseIntArg` (`src/cli/shared.ts`) now validates the literal text with `^[0-9]+$`, so `0x10` is rejected.
- Severity: Medium · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js --compact search Wahl --page-size 0x10`
- Actual: sent as `pageSize=16` (`…"pageSize":16…`), exit 0 — a value the user never typed, despite the help text "Expected a non-negative integer."
- Root cause: `Number("0x10")===16` passes `Number.isInteger`.

### 5. Numeric flags accept exponent notation — ✅ FIXED
**Fix:** `^[0-9]+$` validation in `parseIntArg` (`src/cli/shared.ts`) rejects `1e3`.
- Severity: Medium · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js search Wahl --result-page 1e3` → accepted (exit 0), becomes 1000.

### 6. Numeric flags accept whitespace-padded values — ✅ FIXED
**Fix:** `^[0-9]+$` validation in `parseIntArg` (`src/cli/shared.ts`) rejects `" 5 "`.
- Severity: Medium · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js --timeout " 5 " homepage` → `Error: Request timed out after 5ms` (the `" 5 "` was coerced to 5 rather than rejected).

### 7. Numeric flags accept unsafe-magnitude integers (precision loss) — ✅ FIXED
**Fix:** `parseIntArg` (`src/cli/shared.ts`) now additionally rejects values that fail `Number.isSafeInteger`, so `99999999999999999999` errors instead of silently becoming `1e20`.
- Severity: Medium · Confidence: Likely
- Repro: `node dist/src/cli/index.js search Wahl --page-size 99999999999999999999` → accepted with no error; `Number()` yields `1e20`, which serialises into the query as `100000000000000000000` — a different value than typed. (Same `parseIntArg` root cause as #4–6; the live response did not echo the field back so the transmitted value wasn't directly observed.)

### 8. Empty search text is sent as `searchText=` → server 400, no client guard — ✅ FIXED
**Fix:** The `search` action in `src/cli/commands/news.ts` now rejects empty/whitespace-only text with a `TagesschauError ("search text must not be empty.")` before any request is made (exit 1).
- Severity: Medium · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js search ""`
- Actual: `exit=1  Error: HTTP 400 for GET https://www.tagesschau.de/api2u/search/?searchText=` — the empty query is forwarded verbatim and the raw upstream 400 is surfaced, rather than omitting the param or validating client-side.

## Low

### 9. No-args prints usage to stderr and exits 1 — ✅ FIXED
**Fix:** `run()` in `src/cli/run.ts` now detects a bare invocation (`argv.length === 0`) and prints help to stdout with exit 0, matching `--help`.
- Severity: Low · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js` → `exit=1`, "Usage: …" on stderr. Conventionally a bare invocation shows help on stdout with exit 0 (as `--help` does). Inconsistent with `--help`.

### 10. `--base-url ""` yields a confusing "Invalid URL" message — ✅ FIXED
**Fix:** The `RequestEngine` constructor in `src/client/engine.ts` now throws `TagesschauError ("Base URL must not be empty.")` when an empty/whitespace base URL is supplied.
- Severity: Low · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js --base-url "" homepage` → `Error: Invalid URL: /api2u/homepage/`. An empty base-url isn't guarded by the `?? default` (only `undefined` is), so the path is used as a whole URL. A clearer "base URL must not be empty" would help.

### 11. Connection-refused surfaced as a raw Node error string — ✅ FIXED
**Fix:** The `req.on("error")` handler in `src/client/http.ts` now wraps raw Node socket errors in a branded message naming the error code and target host (e.g. `Network error (ECONNREFUSED) connecting to GET http://127.0.0.1:1: …`), preserving the original via `cause`.
- Severity: Low · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js --base-url http://127.0.0.1:1 homepage` → `Error: connect ECONNREFUSED 127.0.0.1:1` (raw `node:net` message rather than a wrapped/branded network error). Exit 1 is correct; only the message is unpolished.

### 12. `--result-page` / `--page-size` documented range (1–30) not enforced — ✅ FIXED (lower bound)
**Fix:** Added `parsePagingArg` in `src/cli/shared.ts` (used by both `--page-size` and `--result-page` in `src/cli/commands/news.ts`); it builds on `parseIntArg` and additionally rejects `0`, since these parameters are 1-based. Note: no explicit 1–30 upper bound exists in this repo's code, README, or help text, so only the meaningful lower bound (`>= 1`) is enforced rather than inventing an undocumented cap.
- Severity: Low · Confidence: Confirmed
- Repro: `node dist/src/cli/index.js --compact search Wahl --result-page 0` (and `--result-page 1e3`) → accepted, exit 0. Help/spec describe a 1–30 bound that is never checked.

### 13. Error message contradicts accepted input — ✅ FIXED
**Fix:** With the stricter `parseIntArg` in `src/cli/shared.ts`, the accepted inputs now exactly match the message; the message itself was updated to "Expected a non-negative integer in decimal notation." (plus a distinct "Value is too large" message for unsafe magnitudes).
- Severity: Low · Confidence: Confirmed
- The `parseIntArg` error reads "Expected a non-negative integer," yet `0x10`, `1e3`, and `" 5 "` are all accepted (see #4–6). Negative values (`-5`) and `abc` are correctly rejected — so the message is only half-true.

### 14. `--user-agent ""` is accepted (likely sends an empty UA header) — ✅ FIXED
**Fix:** The `RequestEngine` constructor in `src/client/engine.ts` now treats an empty `userAgent` the same as unset and falls back to the default `tagesschau-cli`, so a blank `User-Agent:` header is never sent.
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
