import { test } from "node:test";
import assert from "node:assert/strict";
import { hourlyBudget, REQUESTS_PER_HOUR } from "../src/budget.js";
import { TagesschauNetworkError } from "../src/errors.js";
import type { HttpRequest, HttpResponse, Transport } from "../src/http.js";

const request: HttpRequest = { method: "GET", url: "https://www.tagesschau.de/api2u/homepage/", headers: {} };

function counting(): { transport: Transport; sent: () => number } {
  let sent = 0;
  const transport: Transport = () => {
    sent += 1;
    return Promise.resolve({ status: 200, headers: {}, body: Buffer.from("{}") } as HttpResponse);
  };
  return { transport, sent: () => sent };
}

test("the API's budget is 60 requests an hour", () => {
  assert.equal(REQUESTS_PER_HOUR, 60);
});

test("the request beyond the budget is refused before it is sent, naming when the next is possible", async () => {
  let clock = Date.UTC(2026, 10, 19, 20, 0, 0);
  const { transport, sent } = counting();
  const limited = hourlyBudget(transport, { max: 3, now: () => clock });
  for (let i = 0; i < 3; i += 1) {
    await limited(request);
    clock += 60_000;
  }
  await assert.rejects(limited(request), (err: unknown) => {
    assert.ok(err instanceof TagesschauNetworkError);
    assert.match(err.message, /^GET https:\/\/www\.tagesschau\.de\/api2u\/homepage\/ not sent: /);
    assert.match(err.message, /allows 3 requests an hour/);
    assert.match(err.message, /possible at 21:00 UTC \(in 57 min\)/);
    return true;
  });
  assert.equal(sent(), 3, "the refused request never reached the transport");
});

test("the window slides: a request an hour after the oldest goes out again", async () => {
  let clock = 0;
  const { transport, sent } = counting();
  const limited = hourlyBudget(transport, { max: 2, now: () => clock });
  await limited(request);
  clock = 30 * 60_000;
  await limited(request);
  clock = 60 * 60_000 - 1;
  await assert.rejects(limited(request), TagesschauNetworkError);
  clock = 60 * 60_000;
  await limited(request);
  assert.equal(sent(), 3);
  await assert.rejects(limited(request), TagesschauNetworkError);
});

test("a refused request does not use up the budget", async () => {
  let clock = 0;
  const { transport, sent } = counting();
  const limited = hourlyBudget(transport, { max: 1, now: () => clock });
  await limited(request);
  for (let i = 0; i < 5; i += 1) await assert.rejects(limited(request), TagesschauNetworkError);
  clock = 60 * 60_000;
  await limited(request);
  assert.equal(sent(), 2);
});

test("the default is the API's 60 an hour", async () => {
  const { transport, sent } = counting();
  const limited = hourlyBudget(transport, { now: () => 0 });
  for (let i = 0; i < 60; i += 1) await limited(request);
  await assert.rejects(limited(request), /allows 60 requests an hour/);
  assert.equal(sent(), 60);
});

test("a budget that is not a positive integer is refused", () => {
  const { transport } = counting();
  for (const max of [0, -1, 1.5, Number.NaN]) assert.throws(() => hourlyBudget(transport, { max }), RangeError);
});
