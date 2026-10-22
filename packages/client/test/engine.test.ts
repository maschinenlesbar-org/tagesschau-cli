import { test } from "node:test";
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
  MAX_RETRY_AFTER_MS,
  MAX_DETAIL_LENGTH,
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
} from "../src/errors.js";
import { makeMockTransport, jsonResponse, rawResponse } from "./helpers.js";
import type { HttpResponse } from "../src/http.js";

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
      assert.equal(err.detail, "]0;pwnedbefore[31mafter");
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
