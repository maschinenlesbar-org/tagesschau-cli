import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestEngine, stripCredentialHeaders } from "../src/client/engine.js";
import {
  TagesschauApiError,
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
