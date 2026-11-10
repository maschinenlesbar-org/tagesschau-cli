import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { TextDecoder } from "node:util";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  RequestEngine,
  bigIntegerKeysOption,
  firstInexactNumber,
  scanNumbers,
  stripCredentialHeaders,
  parseRetryAfter,
  sanitizeServerText,
  MAX_RETRY_AFTER_MS,
  MAX_DETAIL_LENGTH,
  validateBaseUrl,
} from "../src/engine.js";
import {
  TagesschauApiError,
  TagesschauError,
  TagesschauNetworkError,
  TagesschauParseError,
  TagesschauValidationError,
  MAX_MESSAGE_VALUE_LENGTH,
  cutForMessage,
  cutText,
  toWellFormed,
  credentialsIn,
  echoedCredentialForms,
} from "../src/errors.js";
import { makeMockTransport, jsonResponse, rawResponse } from "./helpers.js";
import type { HttpRequest, HttpResponse } from "../src/http.js";

test("buildUrl normalises the path and appends the query", () => {
  const e = new RequestEngine({ baseUrl: "https://example.test/" });
  assert.equal(e.buildUrl("api2u/"), "https://example.test/api2u/");
  assert.equal(
    e.buildUrl("/x", { a: "1", b: ["2", "3"] }),
    "https://example.test/x?a=1&b=2&b=3",
  );
});

test("getJson parses a JSON body", async () => {
  const mt = makeMockTransport(() => jsonResponse({ ok: true }));
  const e = new RequestEngine({ transport: mt.transport });
  assert.deepEqual(await e.getJson("/x"), { ok: true });
});

test("getJson throws TagesschauParseError on invalid JSON", async () => {
  const mt = makeMockTransport(() => rawResponse("not json", "application/json"));
  const e = new RequestEngine({ transport: mt.transport });
  await assert.rejects(() => e.getJson("/x"), TagesschauParseError);
});

test("a number the JSON cannot carry exactly is a parse error, never a changed value", async () => {
  // JSON.parse rounds 12345678901234567890 (in any form: .0, e0, E-1) and 9007199254740992.5 to the
  // nearest double, turns 1e400 into Infinity (printed as null) and 1e-400 into 0, silently.
  const body = (n: string) => `{"id":"a","n":${n},"text":"12345678901234567890 in a string"}`;
  for (const n of [
    "12345678901234567890", "-9007199254740993", "1e400", "-1E400", "12345678901234567890.0", "9007199254740993e0",
    "90071992547409930E-1", "9007199254740992.5", "-9007199254740992.5", "1e-400", "-0.0001e-399",
    "123456789012345678901234567890",
    // Subnormal: below 2.2250738585072014e-308 a double has fewer digits (D4).
    "3e-324", "4e-324", "-4.9e-324", "1.2345678901234567e-310", "2.225073858507201e-309",
  ]) {
    const e = new RequestEngine({ transport: makeMockTransport(() => rawResponse(body(n), "application/json")).transport });
    await assert.rejects(e.getJson("/api2u/news/"), (err: unknown) => {
      assert.ok(err instanceof TagesschauParseError, n);
      assert.equal(err.message, `GET https://www.tagesschau.de/api2u/news/: the number ${n} cannot be represented exactly.`);
      return true;
    });
  }
  // What a double carries exactly, or as JSON means it (a decimal fraction below 2^53), passes.
  const exact: Array<[string, number]> = [
    ["9007199254740991", 9007199254740991], ["9007199254740992.0", 2 ** 53], ["9007199254740992e0", 2 ** 53],
    ["90071992547409920E-1", 2 ** 53], ["1e21", 1e21], ["1.2e21", 1.2e21], ["0", 0], ["-0", -0], ["0.0e-500", 0],
    ["1.10", 1.1], ["0.1", 0.1], ["1.00000000000000001", 1], ["5e-324", 5e-324],
    // A subnormal printed as written, and the smallest normal double (D4).
    ["-5e-324", -5e-324], ["1e-310", 1e-310], ["2.2250738585072014e-308", 2.2250738585072014e-308],
    // A double a server printed in its shortest form reads back as that double and prints as the
    // same number: not a changed value, though the decimal is not the double's exact binary value.
    ["1e23", 1e23], ["100000000000000000000000", 1e23], ["1E23", 1e23], ["1.7976931348623157E308", Number.MAX_VALUE], ["-1.7976931348623157e308", -Number.MAX_VALUE],
    ["4.35e30", 4.35e30],
  ];
  for (const [n, value] of exact) {
    const e = new RequestEngine({ transport: makeMockTransport(() => rawResponse(body(n), "application/json")).transport });
    assert.equal((await e.getJson<{ n: number }>("/x")).n, value, n);
  }
});

test("the number check skips strings and costs one pass over the text", async () => {
  // Escaped quotes and backslashes must not end a string early and expose its digits.
  const tricky = `{"id":"a","s":"\\\\\\"12345678901234567890\\\\","t":"1e400","n":[1,2.5,-3e2]}`;
  const e = new RequestEngine({ transport: makeMockTransport(() => rawResponse(tricky, "application/json")).transport });
  assert.deepEqual(await e.getJson("/x"), JSON.parse(tricky));
  // 1 MB of numbers: the scan is linear.
  const big = `[${Array.from({ length: 200_000 }, (_, i) => i * 7).join(",")}]`;
  const f = new RequestEngine({ transport: makeMockTransport(() => rawResponse(big, "application/json")).transport });
  assert.equal((await f.getJson<number[]>("/x")).length, 200_000);
});

test("a 503 is retried up to maxRetries then surfaces as TagesschauApiError", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return jsonResponse({ detail: "busy" }, 503);
  });
  const e = new RequestEngine({
    transport: mt.transport,
    maxRetries: 2,
    sleep: async () => {},
  });
  await assert.rejects(
    () => e.getJson("/x"),
    (err) => err instanceof TagesschauApiError && err.status === 503,
  );
  assert.equal(calls, 3); // initial + 2 retries
});

test("a retried request that then succeeds resolves", async () => {
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return calls === 1 ? jsonResponse({}, 503) : jsonResponse({ ok: 1 });
  });
  const e = new RequestEngine({ transport: mt.transport, sleep: async () => {} });
  assert.deepEqual(await e.getJson("/x"), { ok: 1 });
  assert.equal(calls, 2);
});

test("the User-Agent and Accept headers are sent", async () => {
  const mt = makeMockTransport(() => jsonResponse({}));
  const e = new RequestEngine({ transport: mt.transport, userAgent: "ua/1" });
  await e.getJson("/x");
  assert.equal(mt.last().headers?.["User-Agent"], "ua/1");
  assert.equal(mt.last().headers?.["Accept"], "application/json");
});

test("follows a same-origin redirect to the Location URL", async () => {
  const mt = makeMockTransport((req) => {
    if (req.url.endsWith("/homepage/")) {
      return { status: 308, headers: { location: "/api2u/homepage" }, body: Buffer.from("") };
    }
    return jsonResponse({ ok: 1 });
  });
  const e = new RequestEngine({ baseUrl: "https://example.test", transport: mt.transport });
  assert.deepEqual(await e.getJson("/api2u/homepage/"), { ok: 1 });
  assert.equal(new URL(mt.last().url).pathname, "/api2u/homepage");
});

test("stripCredentialHeaders removes auth headers case-insensitively, keeps the rest", () => {
  const stripped = stripCredentialHeaders({
    Authorization: "Bearer x",
    "X-API-Key": "k",
    Cookie: "s=1",
    cookie: "s=2",
    Accept: "application/json",
    "User-Agent": "ua/1",
  });
  assert.deepEqual(stripped, { Accept: "application/json", "User-Agent": "ua/1" });
});

test("a cross-origin redirect is followed but drops credential headers", async () => {
  // A transport that injects a credential header on the first (origin) leg so we
  // can prove it is gone on the cross-origin leg. The engine itself never sets
  // credential headers, so we simulate one having been added upstream.
  const mt = makeMockTransport((req) => {
    if (req.url.startsWith("https://example.test")) {
      return {
        status: 302,
        headers: { location: "https://other.test/landing" },
        body: Buffer.from(""),
      };
    }
    return jsonResponse({ ok: 1 });
  });
  let firstLegHeaders: Record<string, string> | undefined;
  const wrapped = makeMockTransport(async (req) => {
    if (req.url.startsWith("https://example.test")) {
      firstLegHeaders = req.headers;
      // Mutate the live header map the engine passes through so a stale credential
      // would survive the cross-origin hop unless the engine clones+strips it.
      if (req.headers) req.headers["Authorization"] = "Bearer secret";
    }
    return mt.transport(req);
  });
  const e = new RequestEngine({ baseUrl: "https://example.test", transport: wrapped.transport });
  assert.deepEqual(await e.getJson("/x"), { ok: 1 });
  assert.equal(firstLegHeaders?.["Authorization"], "Bearer secret");
  assert.equal(new URL(wrapped.last().url).origin, "https://other.test");
  assert.equal(wrapped.last().headers?.["Authorization"], undefined);
  // Non-credential headers still travel to the new origin.
  assert.equal(wrapped.last().headers?.["User-Agent"], "tagesschau-cli");
});

test("exhausting the redirect cap throws a clear TagesschauNetworkError", async () => {
  const mt = makeMockTransport(() => {
    // Always redirect to a fresh same-origin path so the loop never terminates.
    const n = mt.calls.length;
    return {
      status: 308,
      headers: { location: `/hop-${n}` },
      body: Buffer.from(""),
    };
  });
  const e = new RequestEngine({
    baseUrl: "https://example.test",
    transport: mt.transport,
    maxRedirects: 2,
  });
  await assert.rejects(
    () => e.getJson("/start"),
    (err) =>
      err instanceof TagesschauNetworkError && /too many redirects/i.test(err.message),
  );
  // initial request + 2 followed redirects = 3 transport calls
  assert.equal(mt.calls.length, 3);
});

test("error detail is stripped of terminal control characters (TGS-02)", async () => {
  // A hostile server puts an ESC (0x1b) OSC sequence into the error detail. It
  // must not survive into the message that run.ts prints to stderr verbatim.
  const ESC = String.fromCharCode(0x1b);
  const detail = `${ESC}]0;pwned${String.fromCharCode(0x07)}before${ESC}[31mafter`;
  const mt = makeMockTransport(() => jsonResponse({ detail }, 500));
  const e = new RequestEngine({ transport: mt.transport, maxRetries: 0 });
  await assert.rejects(
    () => e.getJson("/x"),
    (err) => {
      assert.ok(err instanceof TagesschauApiError);
      // Whole escape sequences go, not only their control bytes (which left "]0;pwned" and
      // "[31m" behind); the text around them stays.
      assert.equal(err.detail, "beforeafter");
      // No control byte (< 0x20, except tab/newline, or 0x7f-0x9f) survives.
      assert.ok(
        ![...(err.detail ?? "")].some((c) => {
          const n = c.charCodeAt(0);
          return (n <= 8) || (n >= 0x0b && n <= 0x1f) || (n >= 0x7f && n <= 0x9f);
        }),
      );
      return true;
    },
  );
});

test("a redirect to a non-http(s) scheme is refused in the engine (TGS-01)", async () => {
  // Even against a custom transport with no scheme guard of its own, the engine
  // must reject a hostile Location: file:/// before handing it to the transport.
  const mt = makeMockTransport((req) => {
    if (req.url.startsWith("https://example.test")) {
      return {
        status: 302,
        headers: { location: "file:///etc/passwd" },
        body: Buffer.from(""),
      };
    }
    return jsonResponse({ ok: 1 });
  });
  const e = new RequestEngine({ baseUrl: "https://example.test", transport: mt.transport });
  await assert.rejects(
    () => e.getJson("/x"),
    (err) =>
      err instanceof TagesschauNetworkError && /unsupported scheme "file:"/i.test(err.message),
  );
  // The redirect target is never handed to the transport (only the first leg ran).
  assert.equal(mt.calls.length, 1);
});

test("a redirect with no Location header throws a clear TagesschauNetworkError", async () => {
  const mt = makeMockTransport(() => ({
    status: 302,
    headers: {},
    body: Buffer.from(""),
  }));
  const e = new RequestEngine({ baseUrl: "https://example.test", transport: mt.transport });
  await assert.rejects(
    () => e.getJson("/x"),
    (err) =>
      err instanceof TagesschauNetworkError && /no Location/i.test(err.message),
  );
});

test("a non-http(s) base URL is rejected in the constructor, before any request", () => {
  // A custom transport has no scheme guard of its own, so the engine must refuse
  // a file:/ftp:/malformed base URL itself rather than hand it to the transport.
  for (const bad of ["file:///etc/passwd", "ftp://example.org", "notaurl"]) {
    const mt = makeMockTransport(() => jsonResponse({ ok: 1 }));
    assert.throws(
      () => new RequestEngine({ baseUrl: bad, transport: mt.transport }),
      (err: unknown) =>
        err instanceof TagesschauValidationError &&
        !(err instanceof TagesschauNetworkError) &&
        err.message.startsWith("Invalid baseUrl: "),
    );
    assert.equal(mt.calls.length, 0);
  }
});

function retryEngine(headers: Record<string, string>) {
  const delays: number[] = [];
  let calls = 0;
  const mt = makeMockTransport(() => {
    calls += 1;
    return {
      status: 429,
      headers: { "content-type": "application/json", ...headers },
      body: Buffer.from('{"detail":"slow"}'),
    };
  });
  const e = new RequestEngine({
    transport: mt.transport,
    maxRetries: 2,
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  return { e, delays, calls: () => calls };
}

test("a 429 waits the server's Retry-After (seconds) before each retry", async () => {
  const r = retryEngine({ "retry-after": "1" });
  await assert.rejects(() => r.e.getJson("/x"), (err) => err instanceof TagesschauApiError && err.status === 429);
  assert.deepEqual(r.delays, [1000, 1000]);
  assert.equal(r.calls(), 3);
});

test("a 429 waits the time left until a Retry-After HTTP date", async () => {
  const soon = new Date(Date.now() + 5_000).toUTCString();
  const r = retryEngine({ "retry-after": soon });
  await assert.rejects(() => r.e.getJson("/x"), TagesschauApiError);
  assert.equal(r.delays.length, 2);
  for (const d of r.delays) assert.ok(d > 3_000 && d <= 5_000, String(d));
});

test("a malformed Retry-After falls back to linear backoff", async () => {
  for (const bad of ["-1", "1.5", "+5", "1e3", "0x10", "soon", "Sunday, 06-Nov-94 08:49:37 GMT", ""]) {
    const r = retryEngine({ "retry-after": bad });
    await assert.rejects(() => r.e.getJson("/x"), TagesschauApiError);
    assert.deepEqual(r.delays, [200, 400], bad);
  }
});

test("a Retry-After beyond MAX_RETRY_AFTER_MS is not retried at all", async () => {
  const far = new Date(Date.now() + 3_600_000).toUTCString();
  for (const ra of ["31", "3600", "99999999999", far]) {
    const r = retryEngine({ "retry-after": ra });
    await assert.rejects(() => r.e.getJson("/x"), (err) => err instanceof TagesschauApiError && err.status === 429);
    assert.deepEqual(r.delays, [], ra);
    assert.equal(r.calls(), 1, ra);
  }
});

test("parseRetryAfter reads delay-seconds and IMF-fixdate only", () => {
  const now = Date.parse("Sat, 26 Sep 2026 10:00:00 GMT");
  assert.equal(parseRetryAfter("5", now), 5000);
  assert.equal(parseRetryAfter([" 2 ", "9"], now), 2000);
  assert.equal(parseRetryAfter("Sat, 26 Sep 2026 10:00:10 GMT", now), 10_000);
  assert.equal(parseRetryAfter("Sat, 26 Sep 2026 09:00:00 GMT", now), 0);
  assert.equal(parseRetryAfter("1.5", now), undefined);
  assert.equal(parseRetryAfter(undefined, now), undefined);
  assert.equal(MAX_RETRY_AFTER_MS, 30_000);
});

test("numeric engine options must be integers in range, or the constructor throws", () => {
  const bad: Array<[string, number]> = [
    ["timeoutMs", NaN], ["timeoutMs", -1], ["timeoutMs", 2_147_483_648], ["timeoutMs", 1.5],
    ["maxRetries", NaN], ["maxRetries", Infinity], ["maxRetries", 11],
    ["retryDelayMs", -1], ["retryDelayMs", 30_001],
    ["maxRedirects", NaN], ["maxRedirects", -1], ["maxRedirects", 21],
    ["maxResponseBytes", -1], ["maxResponseBytes", 2 ** 53],
  ];
  for (const [name, value] of bad) {
    assert.throws(
      () => new RequestEngine({ [name]: value }),
      (err: unknown) =>
        err instanceof TagesschauError &&
        err.message.startsWith(`Invalid option ${name}: expected an integer from 0 to `) &&
        err.message.endsWith(`, got ${String(value)}.`),
      `${name}=${value}`,
    );
  }
  new RequestEngine({ timeoutMs: 0, maxRetries: 10, retryDelayMs: 0, maxRedirects: 20, maxResponseBytes: 0 });
});

test("a Spring-style error body's `error` reason becomes the detail", async () => {
  const body = { timestamp: "2026-09-26T10:03:23.383+02:00", status: 400, error: "Bad Request", path: "/api2u/search/" };
  const mt = makeMockTransport(() => jsonResponse(body, 400));
  const e = new RequestEngine({ baseUrl: "https://example.test", transport: mt.transport });
  await assert.rejects(
    () => e.getJson("/api2u/search/"),
    (err) =>
      err instanceof TagesschauApiError &&
      err.detail === "Bad Request" &&
      err.message === "HTTP 400 for GET https://example.test/api2u/search/: Bad Request",
  );
});

test("the engine refuses a base URL with a query or fragment", () => {
  for (const baseUrl of ["http://h.test/?x=1", "http://h.test/#f"]) {
    assert.throws(
      () => new RequestEngine({ baseUrl }),
      (err: unknown) =>
        err instanceof TagesschauValidationError &&
        err.message === "Invalid baseUrl: A base URL cannot have a query (?) or fragment (#).",
    );
  }
});

test("userinfo never reaches base-URL errors or redirect errors (the request URL carries none)", async () => {
  assert.throws(
    () => new RequestEngine({ baseUrl: "http://u:pw@h.test/#f" }),
    (err: unknown) => err instanceof TagesschauValidationError && !err.message.includes("pw"),
  );
  assert.throws(
    () => new RequestEngine({ baseUrl: "ftp://u:pw@h.test" }),
    (err: unknown) => err instanceof TagesschauValidationError && !err.message.includes("pw"),
  );
  const loop = makeMockTransport(() => ({ status: 302, headers: { location: "/again" }, body: Buffer.from("") }));
  const e = new RequestEngine({ baseUrl: "http://u:pw@h.test", transport: loop.transport, maxRedirects: 1 });
  await assert.rejects(
    () => e.getJson("/x"),
    (err: unknown) => err instanceof TagesschauNetworkError && err.message.includes("http://h.test/") && !err.message.includes("pw"),
  );
  const noLoc = makeMockTransport(() => ({ status: 302, headers: {}, body: Buffer.from("") }));
  const e2 = new RequestEngine({ baseUrl: "http://u:pw@h.test", transport: noLoc.transport });
  await assert.rejects(
    () => e2.getJson("/x"),
    (err: unknown) => err instanceof TagesschauNetworkError && !err.message.includes("pw"),
  );
});

test("the engine refuses an unsendable or blank userAgent with a typed error; only an omitted one is the default", async () => {
  assert.throws(
    () => new RequestEngine({ userAgent: "a\r\nb" }),
    (err: unknown) =>
      err instanceof TagesschauValidationError && err.message === "Invalid userAgent: Value contains control characters.",
  );
  assert.throws(
    () => new RequestEngine({ userAgent: "Tagesschau\u20ac" }),
    (err: unknown) => err instanceof TagesschauValidationError && /outside Latin-1/.test(err.message),
  );
  for (const blank of ["", "   "]) {
    assert.throws(
      () => new RequestEngine({ userAgent: blank }),
      (err: unknown) =>
        err instanceof TagesschauValidationError && err.message === "Invalid userAgent: Expected a non-empty value.",
    );
  }
  new RequestEngine({ userAgent: "a\tb" });
  new RequestEngine({ userAgent: "M\u00fcller" });
  const mt = makeMockTransport(() => jsonResponse({}));
  await new RequestEngine({ transport: mt.transport }).getJson("/x");
  assert.equal(mt.last().headers?.["User-Agent"], "tagesschau-cli");
});

test("error detail: bidi controls dropped, newlines folded, length capped", async () => {
  const rlo = String.fromCharCode(0x202e);
  const mt = makeMockTransport(() => jsonResponse({ detail: `ok ${rlo}txt.exe\nError: forged\u2028line` }, 500));
  const e = new RequestEngine({ baseUrl: "https://example.test", transport: mt.transport });
  await assert.rejects(
    () => e.getJson("/x"),
    (err) =>
      err instanceof TagesschauApiError &&
      err.message === "HTTP 500 for GET https://example.test/x: ok txt.exe Error: forged line",
  );
  const long = makeMockTransport(() => jsonResponse({ detail: "a".repeat(200_000) }, 500));
  const e2 = new RequestEngine({ baseUrl: "https://example.test", transport: long.transport });
  await assert.rejects(
    () => e2.getJson("/x"),
    (err) =>
      err instanceof TagesschauApiError &&
      err.detail === `${"a".repeat(MAX_DETAIL_LENGTH)}…` &&
      err.message.length < 1000 &&
      err.body.length > 200_000,
  );
});

test("Location and Retry-After are read in any case and from a Headers object or Map", async () => {
  // A 302 whose Location comes as a fetch Headers object, a Map or a Title-Case key is followed.
  for (const headers of [new Headers({ Location: "/elsewhere/" }), new Map([["location", "/elsewhere/"]]), { Location: "/elsewhere/" }]) {
    const mt = makeMockTransport((req) =>
      req.url.endsWith("/elsewhere/")
        ? jsonResponse({ ok: 1 })
        : { status: 302, headers: headers as unknown as Record<string, string>, body: Buffer.alloc(0) },
    );
    const e = new RequestEngine({ baseUrl: "https://example.test", transport: mt.transport });
    assert.deepEqual(await e.getJson("/x"), { ok: 1 });
  }
  // A Retry-After above the cap under a Title-Case key is not retried (it was retried twice at
  // 200/400 ms when only lower-case keys were read).
  let calls = 0;
  const delays: number[] = [];
  const e = new RequestEngine({
    transport: async () => {
      calls++;
      return { status: 429, headers: { "Retry-After": "100" } as Record<string, string>, body: Buffer.from("{}") };
    },
    sleep: async (ms) => void delays.push(ms),
  });
  await assert.rejects(() => e.getJson("/x"), (err) => err instanceof TagesschauApiError && err.status === 429);
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test("getJson decodes the body by its declared charset and drops a BOM", async () => {
  const text = "Köln Straße";
  const latin1 = makeMockTransport(() =>
    rawResponse(Buffer.from(JSON.stringify({ title: text }), "latin1"), "application/json; charset=iso-8859-1"),
  );
  assert.deepEqual(await new RequestEngine({ transport: latin1.transport }).getJson("/x"), { title: text });
  const bom = makeMockTransport(() => rawResponse(Buffer.from(`﻿${JSON.stringify({ title: text })}`), "application/json"));
  assert.deepEqual(await new RequestEngine({ transport: bom.transport }).getJson("/x"), { title: text });
  const unknown = makeMockTransport(() => rawResponse("{}", "application/json; charset=x-no-such"));
  await assert.rejects(
    () => new RequestEngine({ transport: unknown.transport }).getJson("/x"),
    (err) => err instanceof TagesschauParseError && err.message === 'GET https://www.tagesschau.de/x: unsupported response charset "x-no-such".',
  );
});

test("cutText never cuts inside a surrogate pair; toWellFormed replaces half a character", () => {
  assert.equal(cutText("ab\u{1f600}cd", 3), "ab");
  assert.equal(cutText("ab\u{1f600}cd", 4), "ab\u{1f600}");
  assert.equal(cutText("short", 10), "short");
  assert.equal(toWellFormed("a\ud83d b\ude00 \u{1f600}"), "a\ufffd b\ufffd \u{1f600}");
});

test("a server detail cut at 500 characters keeps the message well-formed", async () => {
  const detail = "a" + "\u{1f600}".repeat(400);
  const engine = new RequestEngine({ transport: async () => ({ status: 500, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ detail })) }) });
  await assert.rejects(engine.getJson("/api2u/homepage/"), (err: Error) => {
    assert.equal(toWellFormed(err.message), err.message);
    assert.match(err.message, /…$/);
    return true;
  });
});

test("a typed value cut at 500 characters (cutForMessage) keeps the message well-formed", () => {
  const cut = cutForMessage("a".repeat(499) + "\u{1f600}" + "b");
  assert.equal(cut, "a".repeat(499) + "…");
  assert.equal(toWellFormed(cut), cut);
});

test("a redirect target a message quotes is cut at MAX_MESSAGE_VALUE_LENGTH (bug 02-1)", async () => {
  const long = "E".repeat(15000);
  // A chain past the redirect cap: the URL named is the server's last Location.
  const chain = new RequestEngine({
    baseUrl: "https://example.test",
    maxRedirects: 1,
    transport: async (req) => ({ status: 307, headers: { location: req.url.includes("/q/") ? `/q/${long}2` : `/q/${long}` }, body: Buffer.alloc(0) }),
  });
  await assert.rejects(chain.getJson("/api2u/homepage/"), (err: Error) => {
    assert.ok(err instanceof TagesschauNetworkError);
    assert.match(err.message, /^Too many redirects \(>1\) for GET https:\/\/example\.test\/q\/E+…$/);
    assert.ok(err.message.length <= MAX_MESSAGE_VALUE_LENGTH + 60, `${err.message.length}`);
    return true;
  });
  // A scheme of 15 000 letters.
  const scheme = new RequestEngine({
    baseUrl: "https://example.test",
    transport: async () => ({ status: 302, headers: { location: `${"b".repeat(15000)}:x` }, body: Buffer.alloc(0) }),
  });
  await assert.rejects(scheme.getJson("/api2u/news/"), (err: Error) => {
    assert.ok(err instanceof TagesschauNetworkError);
    assert.match(err.message, /^Refusing to follow redirect to unsupported scheme "b+…" \(from GET https:\/\/example\.test\/api2u\/news\/\)$/);
    assert.ok(err.message.length <= MAX_MESSAGE_VALUE_LENGTH + 100, `${err.message.length}`);
    return true;
  });
  // A custom transport that followed a redirect itself names where it ended up.
  const followed = new RequestEngine({
    baseUrl: "https://example.test",
    transport: async () => ({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("{}"), url: `https://other.test/${long}` }),
  });
  await assert.rejects(followed.getJson("/api2u/channels/"), (err: Error) => {
    assert.ok(err instanceof TagesschauNetworkError);
    assert.ok(err.message.length <= 2 * MAX_MESSAGE_VALUE_LENGTH, `${err.message.length}`);
    return true;
  });
});

test("credentials a server echoes are scrubbed from the error: Basic, user:password, password (L13)", async () => {
  // The engine sends the pair UTF-8 encoded, so that is the form a server echoes.
  const basic = Buffer.from("alice:pä ss-pw", "utf8").toString("base64");
  const body = JSON.stringify({ message: `no: Basic ${basic} / alice:pä ss-pw / pä ss-pw` });
  const engine = new RequestEngine({
    baseUrl: "https://alice:p%C3%A4%20ss-pw@127.0.0.1",
    maxRetries: 0,
    transport: async () => ({ status: 401, headers: { "content-type": "application/json" }, body: Buffer.from(body) }),
  });
  await assert.rejects(engine.getJson("/x"), (err: unknown) => {
    assert.ok(err instanceof TagesschauApiError);
    for (const form of [basic, "alice:pä ss-pw", "pä ss-pw"]) assert.ok(!err.message.includes(form), err.message);
    assert.match(err.message, /no: Basic \*\*\* \/ \*\*\* \/ \*\*\*/);
    return true;
  });
});

test("a timeout, the size cap, a refused connection and a DNS failure name the request (kit K3)", async () => {
  // They said only "Request timed out after 20ms", "Response exceeded the size limit …",
  // "Network error (ECONNREFUSED) connecting to GET http://127.0.0.1:9: …" (the origin, not the
  // request) or the transport's bare text, so a caller making several calls could not tell
  // which one failed.
  const url = "http://127.0.0.1:9/api2u/news/";
  const dns = Object.assign(new Error("getaddrinfo ENOTFOUND tagesschau.invalid"), { code: "ENOTFOUND" });
  const own = new TagesschauNetworkError("Request timed out after 5ms");
  const cases: Array<[string, ConstructorParameters<typeof RequestEngine>[0], RegExp, unknown]> = [
    ["engine deadline", { transport: () => new Promise<never>(() => {}), timeoutMs: 20 }, /^Request timed out after 20ms$/, undefined],
    ["size cap", { transport: async () => rawResponse("x".repeat(100), "application/json"), maxResponseBytes: 10 }, /^Response exceeded the size limit of 10 bytes/, undefined],
    ["transport's own timeout", { transport: async () => { throw own; } }, /^Request timed out after 5ms$/, own],
    ["DNS failure", { transport: async () => { throw dns; } }, /^getaddrinfo ENOTFOUND tagesschau\.invalid$/, dns],
    ["a reset", { transport: async () => { throw new TypeError("fetch failed"); } }, /^fetch failed$/, undefined],
  ];
  for (const [name, options, reason, cause] of cases) {
    const e = new RequestEngine({ baseUrl: "http://user:pw@127.0.0.1:9", maxRetries: 0, ...options });
    await assert.rejects(e.getJson("/api2u/news/"), (err) => {
      assert.ok(err instanceof TagesschauNetworkError, name);
      assert.ok(err.message.startsWith(`GET ${url} failed: `), `${name}: ${err.message}`);
      assert.match(err.message.slice(`GET ${url} failed: `.length), reason, name);
      assert.doesNotMatch(err.message, /user|pw/, name);
      if (cause !== undefined) assert.equal(err.cause, cause, name);
      return true;
    });
  }
  // A message that names the request already is not prefixed twice.
  const named = new RequestEngine({ baseUrl: "http://127.0.0.1:9", transport: async () => { throw new TagesschauNetworkError(`GET ${url} failed: x`); } });
  await assert.rejects(named.getJson("/api2u/news/"), { message: `GET ${url} failed: x` });
});

test("a refused connection on the built-in transport names the request and keeps Node's error as the cause", async () => {
  const server = http.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((r) => server.close(() => r()));
  const e = new RequestEngine({ baseUrl: `http://127.0.0.1:${port}`, maxRetries: 0 });
  await assert.rejects(e.getJson("/api2u/news/"), (err) => {
    assert.ok(err instanceof TagesschauNetworkError);
    assert.equal(err.message, `GET http://127.0.0.1:${port}/api2u/news/ failed: connect ECONNREFUSED 127.0.0.1:${port}`);
    let inner: unknown = err.cause;
    while (inner instanceof Error && (inner as NodeJS.ErrnoException).code === undefined) inner = inner.cause;
    assert.equal((inner as NodeJS.ErrnoException).code, "ECONNREFUSED");
    return true;
  });
});

test("a header named __proto__ is an ordinary header, never the prototype of the headers read (T12)", async () => {
  // A JavaScript transport may return any object; JSON.parse makes "__proto__" an own key.
  const headers = JSON.parse('{"__proto__":{"content-type":"application/json; charset=bogus"}}') as Record<string, string>;
  const e = new RequestEngine({ transport: async () => ({ status: 200, headers, body: Buffer.from('{"a":1}') }) });
  // With the prototype set, its "content-type" was read as the answer's, and the bogus charset refused it.
  assert.deepEqual(await e.getJson("/x"), { a: 1 });
  const fetchLike = new Headers([["__proto__", "x"], ["content-type", "application/json"]]);
  const f = new RequestEngine({ transport: async () => ({ status: 200, headers: fetchLike as unknown as Record<string, string>, body: Buffer.from('{"a":1}') }) });
  assert.deepEqual(await f.getJson("/x"), { a: 1 });
});

test("bigIntegerKeys: a declared member's number is its exact literal as a string; others keep the rule (D3)", async () => {
  const body = '{"_version_":1858054135406919680,"small":{"_version_":5},"neg":{"\\u005fversion_":-12345678901234567890},' +
    '"s":{"_version_":"text"},"n":{"_version_":null},"arr":{"_version_":[1]},"t":"\\"_version_\\":1","n2":42}';
  const e = new RequestEngine({
    bigIntegerKeys: new Set(["_version_"]),
    transport: makeMockTransport(() => rawResponse(body, "application/json")).transport,
  });
  assert.deepEqual(await e.getJson("/x"), {
    _version_: "1858054135406919680", small: { _version_: "5" }, neg: { _version_: "-12345678901234567890" },
    s: { _version_: "text" }, n: { _version_: null }, arr: { _version_: [1] }, t: '"_version_":1', n2: 42,
  });
  assert.deepEqual([...e.bigIntegerKeys], ["_version_"]);
  // An undeclared big number is still refused; a declared member doesn't make others exact.
  const other = new RequestEngine({
    bigIntegerKeys: ["_version_"] as unknown as ReadonlySet<string>,
    transport: makeMockTransport(() => rawResponse('{"_version_":1858054135406919680,"id":12345678901234567890}', "application/json")).transport,
  });
  await assert.rejects(other.getJson("/x"), /the number 12345678901234567890 cannot be represented exactly/);
  // Malformed stays malformed: a declared member with a leading zero still fails JSON.parse.
  const malformed = new RequestEngine({ bigIntegerKeys: new Set(["_version_"]), transport: makeMockTransport(() => rawResponse('{"_version_":01}', "application/json")).transport });
  await assert.rejects(malformed.getJson("/x"), TagesschauParseError);
  for (const bad of [new Set([""]), new Set([1]), "x", 5, null]) {
    assert.throws(() => new RequestEngine({ bigIntegerKeys: bad as unknown as ReadonlySet<string> }),
      (err: unknown) => err instanceof TagesschauValidationError && err.message === "Invalid option bigIntegerKeys: expected a set of non-empty member names.");
  }
  // The option reader copies a set or a list; undefined is none.
  const names = new Set(["a"]);
  const copy = bigIntegerKeysOption(names);
  names.add("b");
  assert.deepEqual([...copy], ["a"]);
  assert.deepEqual([...bigIntegerKeysOption(["x", "y"] as unknown as ReadonlySet<string>)], ["x", "y"]);
  assert.equal(bigIntegerKeysOption(undefined).size, 0);
  // Without declarations the scan is the plain number check.
  assert.equal(firstInexactNumber('{"a":"1e400","b":3e-324}'), "3e-324");
  assert.deepEqual(scanNumbers('{"a":1}'), { json: '{"a":1}', inexact: undefined });
});

test("an answer error names the request: method and URL, userinfo redacted (D9)", async () => {
  const answers: Array<[string, () => HttpResponse]> = [
    ["not valid JSON", () => rawResponse("<html>", "text/html")],
    ["empty response body", () => rawResponse(" ", "application/json")],
    ["cannot be represented exactly", () => rawResponse('{"n":1e400}', "application/json")],
    ["unsupported response charset", () => rawResponse("{}", "application/json; charset=x-bogus")],
    ["unsupported Content-Encoding", () => ({ status: 200, headers: { "content-type": "application/json", "content-encoding": "br" }, body: Buffer.from("{}") })],
  ];
  const base = new URL("https://www.tagesschau.de");
  base.username = "alice";
  base.password = "s3cret";
  for (const [what, respond] of answers) {
    const e = new RequestEngine({ baseUrl: base.href, transport: makeMockTransport(respond).transport });
    await assert.rejects(e.getJson("/items", { q: "x" }), (err: unknown) => {
      assert.ok(err instanceof TagesschauParseError, what);
      assert.ok(err.message.startsWith(`GET ${base.protocol}//***@${base.host}`), err.message);
      assert.ok(err.message.includes("/items?q=x: ") && err.message.includes(what), err.message);
      assert.ok(!err.message.includes("s3cret"), err.message);
      return true;
    });
  }
  // An HTML page names its type; a gzip body names its coding; an identity coding is no coding.
  const html = new RequestEngine({ transport: async () => rawResponse("<html>", "text/html; charset=utf-8") });
  await assert.rejects(html.getJson("/x"), (err: Error) =>
    err.message === 'GET https://www.tagesschau.de/x: the answer is not valid JSON (expected JSON, got Content-Type "text/html").');
  const gzip = new RequestEngine({ transport: async () => ({ status: 200, headers: { "content-type": "application/json", "content-encoding": "gzip" }, body: Buffer.from("{}") }) });
  await assert.rejects(gzip.getJson("/x"), (err: Error) =>
    err.message === 'GET https://www.tagesschau.de/x: unsupported Content-Encoding "gzip" (the client does not decompress responses).');
  const identity = new RequestEngine({ transport: async () => ({ status: 200, headers: { "content-type": "application/json", "content-encoding": "identity" }, body: Buffer.from('{"a":1}') }) });
  assert.deepEqual(await identity.getJson("/x"), { a: 1 });
});

test("text that is not valid is replaced with U+FFFD and reported through onWarning, never silently (D2)", async () => {
  const cases: Array<[string, Buffer, string, unknown, number]> = [
    // A lone surrogate written as an escape (high alone, low alone); a real pair and an escaped backslash stay.
    ["lone escapes", Buffer.from('{"a":"x\\ud800y","b":"\\udc00","c":"\\ud83d\\ude00","d":"\\\\ud800"}'), "application/json", { a: "x\ufffdy", b: "\ufffd", c: "\u{1f600}", d: "\\ud800" }, 2],
    // A lone surrogate in a member name.
    ["lone in a key", Buffer.from('{"\\udbff":1}'), "application/json", { "\ufffd": 1 }, 1],
    // Invalid UTF-8 bytes (Latin-1 "Köln" without a charset label); a U+FFFD the server sent is not counted.
    ["invalid bytes", Buffer.concat([Buffer.from('{"a":"K'), Buffer.from([0xf6]), Buffer.from('ln","b":"\ufffd"}')]), "application/json", { a: "K\ufffdln", b: "\ufffd" }, 1],
    // A byte undefined in a single-byte charset.
    ["iso-8859-3", Buffer.concat([Buffer.from('{"a":"'), Buffer.from([0xa5]), Buffer.from('"}')]), "application/json; charset=iso-8859-3", { a: "\ufffd" }, 1],
  ];
  for (const [label, body, type, expected, count] of cases) {
    const warnings: string[] = [];
    const e = new RequestEngine({ onWarning: (m) => warnings.push(m), transport: makeMockTransport(() => rawResponse(body, type)).transport });
    const value = await e.getJson("/items", { q: "x" });
    assert.deepEqual(value, expected, label);
    assert.ok(!/[\ud800-\udfff]/u.test(JSON.stringify(value)), `${label}: well-formed`);
    assert.deepEqual(warnings, [
      `GET https://www.tagesschau.de/items?q=x: ${count} ${count === 1 ? "character" : "characters"} of the answer ${count === 1 ? "was" : "were"} not valid text (invalid bytes or a lone surrogate) and replaced with U+FFFD.`,
    ], label);
  }
  // Valid text: no warning; a throwing hook never fails the request.
  const quiet: string[] = [];
  const ok = new RequestEngine({ onWarning: (m) => quiet.push(m), transport: makeMockTransport(() => rawResponse('{"a":"\\u00fc\ufffd"}', "application/json")).transport });
  assert.deepEqual(await ok.getJson("/x"), { a: "ü\ufffd" });
  assert.deepEqual(quiet, []);
  const throwing = new RequestEngine({ onWarning: () => { throw new Error("hook"); }, transport: makeMockTransport(() => rawResponse('"\\ud800"', "application/json")).transport });
  assert.equal(await throwing.getJson("/x"), "\ufffd");
  assert.throws(() => new RequestEngine({ onWarning: "log" as unknown as () => void }), TagesschauValidationError);
});

test("an answer longer than V8's longest string is a TagesschauParseError naming the request, not a plain Error (T14)", async (t) => {
  // A real one needs a body of 512 MB and more (possible with maxResponseBytes 0): V8's own
  // error is stood in for, for the body marked by its length.
  const huge = Buffer.from('{"channels":[{"title":"tagesschau24"}]}                    ');
  const tooLong = Object.assign(new Error("Cannot create a string longer than 0x1fffffe8 characters"), { code: "ERR_STRING_TOO_LONG" });
  const decode = TextDecoder.prototype.decode;
  t.mock.method(TextDecoder.prototype, "decode", function (this: InstanceType<typeof TextDecoder>, input?: Uint8Array, options?: { stream?: boolean }) {
    if (input !== undefined && input.byteLength === huge.length) throw tooLong;
    return decode.call(this, input, options);
  });
  const toString = Buffer.prototype.toString;
  t.mock.method(Buffer.prototype, "toString", function (this: Buffer, ...args: Parameters<Buffer["toString"]>) {
    if (this.length === huge.length && args[0] === "utf8") throw tooLong;
    return toString.apply(this, args);
  });
  const e = new RequestEngine({ maxResponseBytes: 0, transport: makeMockTransport(() => rawResponse(huge, "application/json")).transport });
  await assert.rejects(e.getJson("/api2u/channels/", { q: "1=1" }), (err: unknown) => {
    assert.ok(err instanceof TagesschauParseError, String(err));
    assert.equal(
      err.message,
      `GET https://www.tagesschau.de/api2u/channels/?q=1%3D1: the answer is too large to read as text (${huge.length} bytes; the longest string is 536870888 characters).`,
    );
    return true;
  });
  // An error status with such a body is still the API error, without the unreadable body.
  const failing = new RequestEngine({ maxResponseBytes: 0, transport: makeMockTransport(() => rawResponse(huge, "text/plain", 500)).transport });
  await assert.rejects(failing.getJson("/api2u/channels/"), (err: unknown) => err instanceof TagesschauApiError && err.status === 500 && err.body === "");
});

test("a number literal with a long run of zeros is checked in linear time, with the same verdicts", () => {
  // `/0+$/` tried a match at every zero of a run that doesn't end the digits: quadratic, and an
  // 80 KB answer held the CLI for seconds past --timeout (the scan runs once the answer is in).
  const zeros = "0".repeat(100_000);
  for (const literal of [`1.${zeros}1e300`, `1${zeros}1`, `0.${zeros}1e-400`, `-1${zeros}1`]) {
    const start = performance.now();
    const inexact = firstInexactNumber(`{"n":${literal}}`);
    const ms = performance.now() - start;
    assert.ok(ms < 1000, `${literal.slice(0, 12)}…: ${Math.round(ms)} ms`);
    assert.equal(inexact, literal, literal.slice(0, 12));
  }
  // Leading and trailing zeros still don't count: these are the doubles they print as.
  for (const exact of ["9007199254740992000e-3", "1e23", "100000000000000000000000", "0.0", "-0e5", "5e-324", "0.000e-400"]) {
    assert.equal(firstInexactNumber(`[${exact}]`), undefined, exact);
  }
  for (const inexact of ["12345678901234567890", "3e-324", "1e-400", "1.0000000000000000000000001e300"]) {
    assert.equal(firstInexactNumber(`[${inexact}]`), inexact, inexact);
  }
});

test("redactUrlUserinfo hides every URL's userinfo in one linear pass, however many URLs", async () => {
  const { redactUrlUserinfo } = await import("../src/errors.js");
  const elapsed = (f: () => unknown): number => {
    const started = performance.now();
    f();
    return performance.now() - started;
  };
  // The URL regex this replaces (a scheme tried at every word start) takes about 3 s on this.
  assert.ok(elapsed(() => redactUrlUserinfo("a.".repeat(30_000))) < 1000);
  assert.equal(redactUrlUserinfo("a -https://u:p@h/x and x-ftp://v@w?q, mail@example.org"), "a -https://***@h/x and x-ftp://***@w?q, mail@example.org");
  assert.equal(redactUrlUserinfo("argument 'ftp://user:s3cret@h.example' is invalid"), "argument 'ftp://***@h.example' is invalid");
  assert.equal(redactUrlUserinfo("1://u:p@h ://u:p@h"), "1://u:p@h ://u:p@h");
  assert.equal(redactUrlUserinfo("https://h/p?u=a@b"), "https://h/p?u=a@b");
  for (const text of ["a".repeat(1_000_000), "a.".repeat(500_000), "://".repeat(100_000), `https://${"u".repeat(1_000_000)}`]) {
    assert.equal(redactUrlUserinfo(text), text);
  }
  assert.equal(redactUrlUserinfo("https://u:p@h ".repeat(100_000)), "https://***@h ".repeat(100_000));
});

function elapsed(work: () => unknown): number {
  const start = performance.now();
  work();
  return performance.now() - start;
}

test("redactUrlUserinfo hides the userinfo of a URL glued onto the one before it, still linear (B2)", async () => {
  const { redactUrlUserinfo } = await import("../src/errors.js");
  // The authority read for the first `://` ends at the `/` of the second; the second URL starts
  // inside it (its scheme is the first one's host, or follows a redacted `@`), so the search goes
  // on after each `://`, not after the authority. The regex this replaces redacted both; the
  // first linear pass missed them.
  assert.equal(redactUrlUserinfo("https://host://u:p@h"), "https://host://***@h");
  assert.equal(redactUrlUserinfo("https://u:p@x://v:q@w"), "https://***@x://***@w");
  assert.equal(redactUrlUserinfo("see https://h.example:/x://u:p@h"), "see https://h.example:/x://***@h");
  assert.equal(redactUrlUserinfo("https://u:p@1://v:q@w"), "https://***@1://v:q@w");
  // Many glued URLs, unredacted and redacted, and long scheme-character runs: one pass each.
  const n = 100_000;
  for (const [text, want] of [
    [`${"a://".repeat(n)}u:p@h`, `${"a://".repeat(n)}***@h`],
    ["x://u:p@".repeat(n), "x://***@".repeat(n)],
    [`${"a.".repeat(500_000)}://u:p@h`, `${"a.".repeat(500_000)}://***@h`],
    [`https://${"a.".repeat(500_000)}://u:p@h`, `https://${"a.".repeat(500_000)}://***@h`],
    ["a:".repeat(500_000), "a:".repeat(500_000)],
  ] as const) {
    let got = "";
    const ms = elapsed(() => (got = redactUrlUserinfo(text)));
    assert.ok(got === want, `${text.slice(0, 40)}…`);
    assert.ok(ms < 1000, `${Math.round(ms)} ms on ${text.slice(0, 40)}…`);
  }
});

test("a TextBuilder joins its pieces in order across batches", async () => {
  const { TextBuilder } = await import("../src/errors.js");
  const b = new TextBuilder();
  const expected: string[] = [];
  for (let i = 0; i < 40_000; i++) {
    b.push(String(i), ",");
    expected.push(String(i), ",");
  }
  assert.equal(b.toString(), expected.join(""));
  assert.equal(new TextBuilder().toString(), "");
});

test("a base URL with a backslash is refused by the engine, never echoing the password", () => {
  const pw = "s3cretpw";
  // WHATWG ends an http(s) host at "\\": the request went to remote.example with u's Basic value
  // while every check saw 127.0.0.1 (loopback, so without the cleartext warning) or api.example.
  for (const base of [`http://u:${pw}@127.0.0.1\\@remote.example`, `https://alice:${pw}@api.example\\@evil.example`, "https://a.test\\@b.test", "https:\\\\h.example"]) {
    for (const build of [() => new RequestEngine({ baseUrl: base }), () => validateBaseUrl(base)]) {
      assert.throws(
        build,
        (err: unknown) => err instanceof TagesschauValidationError && /backslash/.test(err.message) && !err.message.includes(pw),
        base,
      );
    }
  }
});

test("credentialsIn ends the authority of a special scheme at a backslash and skips the slashes WHATWG skips", () => {
  for (const scheme of ["http", "https", "HTTPS", "ws", "wss", "ftp"]) {
    assert.deepEqual(credentialsIn(`${scheme}://u:p@a.example\\@b.example/x`), ["u:p"], scheme);
    assert.equal(new URL(`${scheme}://u:p@a.example\\@b.example/x`).password, "p", scheme);
  }
  // Another scheme's authority runs on to "/", "?" or "#".
  assert.deepEqual(credentialsIn("foo://u:p@a.example\\@b.example/x"), ["u:p@a.example\\"]);
  assert.deepEqual(credentialsIn("https://u:p@a.example/x\\@y"), ["u:p"]);
  assert.deepEqual(credentialsIn("https://alice:pw@api.example/v1/@x"), ["alice:pw"]);
  // After a special scheme WHATWG skips any number of "/" and "\\" (none too): the userinfo
  // starts after them.
  for (const base of ["http:alice:pw@h.example", "http:/alice:pw@h.example", "http:///alice:pw@h.example/x", "HTTPS:\\\\alice:pw@h.example", "https:/\\/alice:pw@h.example"]) {
    assert.deepEqual(credentialsIn(base), ["alice:pw"], base);
    assert.equal(new URL(base).password, "pw", base);
  }
  // Without a scheme there is no URL, and a non-special scheme needs its "//".
  assert.deepEqual(credentialsIn("alice:pw@h.example"), []);
  assert.deepEqual(credentialsIn("foo:alice:pw@h.example"), []);
});

test("requests go to the host of the parsed base URL, spelled as it parses, with the userinfo only in the Authorization header", async () => {
  for (const base of [
    "https://alice:pw@api.example/v1/@evil.example",
    "https://API.Example:443/v1",
    "https://bob:p%40ss@h.example:8443/m/",
    "http:///carol:pw@127.0.0.1:9/m",
    "https://tok3n@h.example",
  ]) {
    const parsed = new URL(base);
    const mt = makeMockTransport(() => jsonResponse({ channels: [] }));
    await new RequestEngine({ transport: mt.transport, baseUrl: base }).getJson("/api2u/channels/");
    const sent = mt.last();
    assert.equal(new URL(sent.url).origin, parsed.origin, `${base}: ${sent.url}`);
    // The URL as sent names that host in the text too, without the userinfo, so a transport
    // that reads the string (not the parsed URL) reaches the same host and sends no credential.
    assert.equal(sent.url.slice(sent.url.indexOf("//") + 2).split("/")[0], parsed.host, `${base}: ${sent.url}`);
    const pair = parsed.username === "" ? undefined : `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`;
    assert.equal(sent.headers?.["Authorization"], pair === undefined ? undefined : `Basic ${Buffer.from(pair).toString("base64")}`, base);
  }
});

test("the base URL's userinfo is scrubbed as typed and as WHATWG spells it, after slashes WHATWG skips too", async () => {
  // `p"x` is typed raw and sent percent-encoded (`p%22x`); a server may echo either.
  for (const [base, echoes] of [
    ['https://alice:p"x-secret@mirror.example', ['alice:p"x-secret@', "alice:p%22x-secret@", 'alice:p"x-secret', 'p"x-secret']],
    ["http:///alice:s3cretpw@127.0.0.1:9", ["alice:s3cretpw", "s3cretpw", Buffer.from("alice:s3cretpw").toString("base64")]],
  ] as const) {
    for (const echo of echoes) {
      const engine = new RequestEngine({
        baseUrl: base,
        maxRetries: 0,
        transport: async () => ({ status: 401, headers: { "content-type": "text/plain" }, body: Buffer.from(`bad login ${echo} here`) }),
      });
      await assert.rejects(engine.getJson("/api2u/channels/"), (err: unknown) => {
        assert.ok(err instanceof TagesschauApiError, String(err));
        assert.ok(!err.message.includes(echo) && !err.body.includes(echo), `${base} ${echo}: ${err.message} | ${err.body}`);
        return true;
      });
    }
  }
});

// ---- server text and answers in linear time and bounded memory (security audit 2026-10-27, class C)
// sanitizeServerText appended one character at a time over the whole server text and was cut to
// 500 only afterwards: one rope node per character, so a 16 MB error detail aborted the process
// under a small heap. wellFormedEscapes (per repaired lone surrogate) and scanNumbers (per
// declared member) built their copy with one `+=` per piece the same way.

test("sanitizeServerText reads a bounded prefix and drops what the per-character filter dropped", () => {
  // The filter it replaces, one character at a time: C0 but TAB to CR, DEL, C1 and Cf go.
  const perCharacter = (text: string): string =>
    [...text]
      .filter((ch) => {
        const n = ch.codePointAt(0) ?? 0;
        return (n >= 0x09 && n <= 0x0d) || !(n <= 0x1f || (n >= 0x7f && n <= 0x9f) || /\p{Cf}/u.test(ch));
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  const every = Array.from({ length: 0x3000 }, (_, i) => String.fromCharCode(i)).join("") + "\u{1f600}\u{e0001}\ud800x";
  for (let at = 0; at < every.length; at += 512) {
    const piece = every.slice(at, at + 512).replace(/[\u001b\u0090\u0098\u009b-\u009f]/g, "");
    assert.equal(sanitizeServerText(piece), perCharacter(piece), `from U+${at.toString(16)}`);
  }
  // At most 16 384 units of the text are read, never half a surrogate pair.
  assert.equal(sanitizeServerText("x".repeat(100_000)).length, 16_384);
  assert.equal(sanitizeServerText(`${"x".repeat(16_383)}\u{1f600}`), "x".repeat(16_383));
  // A whole escape sequence goes, not only its control bytes.
  assert.equal(sanitizeServerText("a\u001b]0;title\u0007b \u001b[31mred\u001b[0m"), "ab red");
  // A control string ends at another introducer: the first is dropped by the filter, the second
  // string as a whole.
  const OSC8 = String.fromCharCode(0x9d);
  const ST8 = String.fromCharCode(0x9c);
  assert.equal(sanitizeServerText(`a${OSC8}0;x${OSC8}0;t${ST8}b`), "a0;xb");
  assert.equal(sanitizeServerText("a\u001b]0;x\u001b]0;t\u0007b"), "a0;xb");
});

test("an error answer of unterminated control-string introducers is cleaned in linear time", async () => {
  // An introducer allowed inside a control string made a run of them quadratic (100 000 × U+009D: 16 s).
  for (const opener of ["\\u009d", "\\u0090", "\\u0098", "\\u009e", "\\u009f", "\\u001b]"]) {
    const body = `{"detail":"${opener.repeat(100_000)} tail"}`;
    const e = new RequestEngine({ maxRetries: 0, transport: makeMockTransport(() => rawResponse(body, "application/json", 500)).transport });
    let err: unknown;
    const ms = await elapsedAsync(async () => (err = await e.getJson("/x").catch((caught: unknown) => caught)));
    assert.ok(ms < 1000, `${opener}: ${Math.round(ms)} ms`);
    assert.ok(err instanceof TagesschauApiError, String(err));
    assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(err.message), `${opener}: a control character in the message`);
  }
});

async function elapsedAsync(work: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await work();
  return performance.now() - start;
}

// These tests start a process with a small heap: 30 s instead of the suite's 5 s.
const STARTS_A_PROCESS = { timeout: 30_000 };

test("a 16 MB error detail and millions of lone surrogate escapes are handled within a small heap", STARTS_A_PROCESS, () => {
  const index = new URL("../src/index.js", import.meta.url).href;
  const script = `
    const { TagesschauClient } = await import(${JSON.stringify(index)});
    const answers = {
      detail: () => [500, JSON.stringify({ detail: "x ".repeat(8_000_000) })],
      surrogates: () => [200, '{"channels":[{"title":"' + "\\\\ud800".repeat(6_000_000) + '"}]}'],
    };
    for (const [name, answer] of Object.entries(answers)) {
      const client = new TagesschauClient({ maxRetries: 0, transport: async () => {
        const [status, body] = answer();
        return { status, headers: { "content-type": "application/json" }, body: Buffer.from(body) };
      } });
      try {
        const result = await client.channels();
        console.log(name, "ok", result.channels[0].title.length);
      } catch (err) {
        console.log(name, err.name, err.message.length);
      }
    }
  `;
  const out = execFileSync(process.execPath, ["--max-old-space-size=128", "--input-type=module", "-e", script], { encoding: "utf8" });
  const lines = out.trim().split("\n").map((line) => line.split(" "));
  assert.deepEqual(lines.map(([name, kind]) => `${name} ${kind}`), ["detail TagesschauApiError", "surrogates ok"]);
  assert.ok(Number(lines[0]?.[2]) < 1000, `a message of ${lines[0]?.[2]} characters`);
  assert.equal(lines[1]?.[2], "6000000");
});

test("scanNumbers quotes millions of declared members within a small heap", STARTS_A_PROCESS, () => {
  // One `+=` per quoted member made a rope node each: 3 million of them exhausted a 128 MB heap.
  const engine = new URL("../src/engine.js", import.meta.url).href;
  const n = 3_000_000;
  const script =
    `const { scanNumbers } = await import(${JSON.stringify(engine)});` +
    `const json = "[" + '{"k":1},'.repeat(${n - 1}) + '{"k":1}]';` +
    `process.stdout.write(String(scanNumbers(json, new Set(["k"])).json.length));`;
  const out = execFileSync(process.execPath, ["--max-old-space-size=128", "--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(out, String(n * 10 + 1));
});

// ---- the credential scrubbed from decoded error text (security audit 2026-10-27, class D) ----
// toApiError scrubbed the body as sent and only then decoded its detail with JSON.parse: an echo
// of the base URL's password behind a JSON escape (`s`, `\"`, `ä`) passed the scrub and
// reached .message and .detail decoded, and .body kept it one JSON.parse away.

/** `text` as a JSON string with every character written as a `\uXXXX` escape. */
function everyCharEscaped(text: string): string {
  return `"${Array.from(text, (ch) => Array.from({ length: ch.length }, (_, i) => `\\u${ch.charCodeAt(i).toString(16).padStart(4, "0")}`).join("")).join("")}"`;
}

test("a credential echoed with JSON escapes is scrubbed from the message, the detail and the decoded body", async () => {
  // A password with inner spaces is scrubbed whole, never word by word (its first word too).
  const user = "alice";
  const pw = 'longword s3cret-pw ä"q';
  const base = `https://${user}:${encodeURIComponent(pw)}@mirror.example`;
  const basic = Buffer.from(`${user}:${pw}`, "utf8").toString("base64");
  const asciiOnly = (value: string): string => JSON.stringify(value).replace(/[^\x20-\x7e]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
  const bodies = [
    `{"message":${asciiOnly(`denied for ${pw}`)}}`,
    `{"detail":${JSON.stringify(`denied for ${user}:${pw}`)}}`,
    `{"error":${everyCharEscaped(`denied for ${pw}`)}}`,
    `{"message":${everyCharEscaped(`Basic ${basic}`)}}`,
  ];
  for (const status of [401, 500]) {
    for (const body of bodies) {
      const engine = new RequestEngine({ baseUrl: base, maxRetries: 0, transport: async () => rawResponse(body, "application/json", status) });
      const err = await engine.getJson("/x").catch((caught: unknown) => caught);
      assert.ok(err instanceof TagesschauApiError, String(err));
      const decodedBody = JSON.stringify(JSON.parse(err.body));
      for (const [name, text] of [["message", err.message], ["detail", err.detail ?? ""], ["body", err.body], ["decoded body", decodedBody], ["parsed body", String(Object.values(JSON.parse(err.body) as object)[0])]] as Array<[string, string]>) {
        for (const secret of [pw, "longword", "s3cret-pw", basic]) assert.ok(!text.includes(secret), `${status} ${body}: ${name} holds ${secret}: ${text}`);
      }
      assert.match(err.detail ?? "", /\*\*\*/, body);
    }
  }
});

test("an error body keeps its spelling unless a credential hides behind an escape", async () => {
  const base = "https://alice:s3cret-pw@mirror.example";
  const bodyOf = async (body: string): Promise<string> => {
    const e = new RequestEngine({ baseUrl: base, maxRetries: 0, transport: async () => rawResponse(body, "application/json", 500) });
    const err = await e.getJson("/x").catch((caught: unknown) => caught);
    assert.ok(err instanceof TagesschauApiError, String(err));
    return err.body;
  };
  // No credential, or one spelled as sent: the body as sent (scrubbed), escapes kept.
  assert.equal(await bodyOf('{"m":"caf\\u00e9 \\"x\\""}'), '{"m":"caf\\u00e9 \\"x\\""}');
  assert.equal(await bodyOf('{"m":"pw s3cret-pw \\u00e9"}'), '{"m":"pw *** \\u00e9"}');
  // Escaped: written again decoded, scrubbed in that spelling.
  assert.equal(await bodyOf('{"m":"pw s3cret\\u002dpw \\u00e9"}'), '{"m":"pw *** é"}');
  // Not JSON: nobody decodes it, it stays as sent.
  assert.equal(await bodyOf("pw s3cret\\u002dpw"), "pw s3cret\\u002dpw");
  // Deeply nested: written again where this runtime can, else left out (probed, not assumed:
  // whether JSON.stringify recurses depends on the Node version).
  const deep = `${"[".repeat(200_000)}"s3cret\\u002dpw"${"]".repeat(200_000)}`;
  let parses = true;
  let writes = true;
  try {
    const value: unknown = JSON.parse(deep);
    try {
      JSON.stringify(value);
    } catch {
      writes = false;
    }
  } catch {
    parses = false;
  }
  if (parses) {
    const body = await bodyOf(deep);
    assert.ok(!body.includes("s3cret"), body.slice(199_990, 200_030));
    assert.equal(body === "", !writes);
  }
});

test("a credential a server echoes percent-encoded is scrubbed, the pair and the Basic value too", async () => {
  const pw = "my s3cret/pw";
  const base = `https://alice:${encodeURIComponent(pw)}@mirror.example`;
  const basic = Buffer.from(`alice:${pw}`, "utf8").toString("base64");
  for (const echo of [encodeURIComponent(pw), encodeURIComponent(`alice:${pw}`), encodeURIComponent(basic)]) {
    const engine = new RequestEngine({ baseUrl: base, maxRetries: 0, transport: async () => rawResponse(`{"message":"login?u=${echo}"}`, "application/json", 403) });
    const err = await engine.getJson("/x").catch((caught: unknown) => caught);
    assert.ok(err instanceof TagesschauApiError, String(err));
    for (const text of [err.message, err.detail ?? "", err.body]) assert.ok(!text.includes(echo) && !text.includes("s3cret"), `${echo}: ${text}`);
  }
});

// ---- a redirect's Location echoing the credential (security audit 2026-10-27, class D2) ------
// The engine follows redirects. Every message about the request after one named the followed URL
// through redactUrl only, which drops the URL's own userinfo but not the base URL's credentials a
// server echoed in its path or query.

test("a credential echoed in a redirect's Location never reaches a message about the request after it", async () => {
  const pw = "it's-s3cret";
  const base = `https://alice:${encodeURIComponent(pw)}@mirror.example`;
  const basic = Buffer.from(`alice:${pw}`, "utf8").toString("base64");
  const locations = [
    `https://other.example/login?pw=${pw}`, // raw, with a ' that resolving writes as %27
    `https://other.example/login?pw=${encodeURIComponent(pw)}`,
    `/login/${encodeURIComponent(`alice:${pw}`)}/x`,
    `https://other.example/auth?h=${basic}`,
    `/relative/${pw}`,
  ];
  const leaks = (text: string): boolean => text.includes("s3cret") || text.includes(basic) || text.includes(encodeURIComponent(basic));
  const redirect = (location: string): HttpResponse => ({ status: 302, headers: { location }, body: Buffer.from("") });
  for (const location of locations) {
    const cases: Array<[string, (req: HttpRequest, n: number) => HttpResponse | Promise<HttpResponse>]> = [
      ["an error answer", (_req, n) => (n === 0 ? redirect(location) : rawResponse('{"message":"gone"}', "application/json", 404))],
      ["the redirect limit", () => redirect(location)],
      ["a transport failure", async (_req, n) => {
        if (n === 0) return redirect(location);
        throw new Error("socket hang up");
      }],
      ["the size cap", (_req, n) => (n === 0 ? redirect(location) : rawResponse("x".repeat(100), "application/json"))],
      ["an invalid response", (_req, n) => (n === 0 ? redirect(location) : ({ status: 0 } as unknown as HttpResponse))],
      ["a redirect without Location", (_req, n) => (n === 0 ? redirect(location) : { status: 302, headers: {}, body: Buffer.from("") })],
    ];
    for (const [name, answer] of cases) {
      let n = 0;
      const engine = new RequestEngine({
        baseUrl: base,
        maxRetries: 0,
        maxRedirects: 2,
        maxResponseBytes: 50,
        transport: async (req) => answer(req, n++),
      });
      const err = await engine.getJson("/api2u/news/").catch((caught: unknown) => caught);
      assert.ok(err instanceof TagesschauError, `${location} ${name}: ${String(err)}`);
      const url = err instanceof TagesschauApiError ? err.url : "";
      assert.ok(!leaks(err.message) && !leaks(url), `${location} ${name}: ${err.message} | ${url}`);
    }
  }
  // onRetry's url, after a redirect.
  const retried: string[] = [];
  let n = 0;
  const engine = new RequestEngine({
    baseUrl: base,
    maxRetries: 1,
    sleep: async () => {},
    transport: async () => (n++ === 0 ? redirect(locations[0] as string) : rawResponse("{}", "application/json", 503)),
    onRetry: (event) => retried.push(event.url),
  });
  await engine.getJson("/x").catch(() => undefined);
  assert.equal(retried.length, 1);
  assert.ok(!leaks(retried[0] as string), retried[0]);
});

test("a refused redirect scheme and the origin a dropped-credentials hint names are scrubbed", async () => {
  const pw = "s3cret-pw";
  const base = `https://alice:${pw}@mirror.example`;
  const run = async (location: string, then: HttpResponse): Promise<string> => {
    let n = 0;
    const engine = new RequestEngine({ baseUrl: base, maxRetries: 0, transport: async () => (n++ === 0 ? { status: 302, headers: { location }, body: Buffer.from("") } : then) });
    const err = await engine.getJson("/x").catch((caught: unknown) => caught);
    assert.ok(err instanceof TagesschauError, String(err));
    return err.message;
  };
  const scheme = await run(`${pw}://elsewhere/`, rawResponse("{}", "application/json"));
  assert.match(scheme, /unsupported scheme/);
  assert.ok(!scheme.includes(pw), scheme);
  const hint = await run(`https://${pw}.example/x`, rawResponse("{}", "application/json", 401));
  assert.match(hint, /dropped the base URL's credentials/);
  assert.ok(!hint.includes(pw), hint);
});

// ---- a userinfo without a password (security audit 2026-10-27, class E) ---------------------

test("echoedCredentialForms treats a userinfo without a password as a token (Basic `TOKEN:`) (E)", () => {
  const basic = (pair: string): string => Buffer.from(pair, "utf8").toString("base64");
  assert.deepEqual(echoedCredentialForms("alice:s3cret"), [basic("alice:s3cret"), "alice:s3cret", "s3cret"]);
  assert.deepEqual(echoedCredentialForms("T0ken"), [basic("T0ken:"), "T0ken:", "T0ken"]);
  assert.deepEqual(echoedCredentialForms("T0ken:"), [basic("T0ken:"), "T0ken:", "T0ken"]);
  assert.deepEqual(echoedCredentialForms("T%C3%B6k"), [basic("Tök:"), "Tök:"]); // short: not alone
  assert.deepEqual(echoedCredentialForms(":pw12"), [basic(":pw12"), ":pw12", "pw12"]);
  assert.deepEqual(echoedCredentialForms(""), []);
  assert.deepEqual(echoedCredentialForms(":"), []);
});

test("a token as the base URL's user name is scrubbed from the error in every form a server echoes it (E)", async () => {
  const token = "tok3nsecretvalue";
  const basic = Buffer.from(`${token}:`, "utf8").toString("base64");
  for (const base of [`https://${token}@mirror.example`, `https://${token}:@mirror.example`]) {
    for (const echo of [`bad token ${token}`, `rejected credentials Basic ${basic}`, `user ${token}: unknown`]) {
      const engine = new RequestEngine({ baseUrl: base, maxRetries: 0, transport: async () => jsonResponse({ detail: echo }, 401) });
      const err = await engine.getJson("/x").catch((caught: unknown) => caught);
      assert.ok(err instanceof TagesschauApiError, String(err));
      const seen = `${err.message}\n${err.body}\n${err.url}`;
      assert.ok(!seen.includes(token) && !seen.includes(basic), `${base} ${echo}: ${seen}`);
    }
  }
});
