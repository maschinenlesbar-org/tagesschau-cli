import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RequestEngine,
  stripCredentialHeaders,
  parseRetryAfter,
  MAX_RETRY_AFTER_MS,
} from "../src/client/engine.js";
import {
  TagesschauApiError,
  TagesschauError,
  TagesschauNetworkError,
  TagesschauParseError,
} from "../src/client/errors.js";
import { makeMockTransport, jsonResponse, rawResponse } from "./helpers.js";

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
      TagesschauNetworkError,
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
