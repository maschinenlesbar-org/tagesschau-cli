// Conformance test P8 + P9 + P13 (fix plan 2026-10-06): a body is decoded by its declared
// charset (P8); a 2xx body without the documented shape is a parse error, never data or
// "nothing found" (P9); every rejected input is the library's validation error, never a raw
// TypeError or RangeError (P13). Shared across the *-cli repos; only the adapter differs.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { HttpResponse } from "../src/client/http.js";

// ---- adapter (per repo) -------------------------------------------------------------
import { TagesschauClient as Client } from "../src/client/client.js";
import {
  TagesschauError as BaseError,
  TagesschauParseError as ParseError,
  TagesschauValidationError as ValidationError,
} from "../src/client/errors.js";
/** A call whose answer contains a text field, and how to read that field from the result. */
const textCall = (client: Client): Promise<unknown> => client.news();
const textBody = (text: string): unknown => ({ news: [{ title: text }], regional: [] });
const readText = (result: unknown): string => (result as { news: Array<{ title: string }> }).news[0]!.title;
/** 2xx bodies the call must reject (error envelopes, empty or wrong shapes). `{ news: [] }` is not one: it is an empty feed. */
const malformedBodies: unknown[] = [null, {}, "text", 42, [], { error: "boom" }, { news: null }, { news: "x" }, { news: [], regional: {} }];
/** Library calls with wrong-typed or out-of-range input. */
const badCalls: Array<[string, () => unknown]> = [
  ["news(null)", () => new Client().news(null as never)],
  ["news({ regions: '9' })", () => new Client().news({ regions: "9" as never })],
  ["news({ regions: [9] })", () => new Client().news({ regions: [9] as never })],
  ["news({ ressort: null })", () => new Client().news({ ressort: null as never })],
  ["news({ date: 261004 })", () => new Client().news({ date: 261004 as never })],
  ["news({ date: '260230' })", () => new Client().news({ date: "260230" })],
  ["news({ ressort, regions })", () => new Client().news({ ressort: "inland", regions: ["9"] })],
  ["search(null)", () => new Client().search(null as never)],
  ["search({ searchText: 5 })", () => new Client().search({ searchText: 5 as never })],
  ["search({ pageSize: '5' })", () => new Client().search({ searchText: "x", pageSize: "5" as never })],
  ["timeoutMs: 'x'", () => new Client({ timeoutMs: "x" as unknown as number })],
  ["timeoutMs: -1", () => new Client({ timeoutMs: -1 })],
  ["maxRetries: 11", () => new Client({ maxRetries: 11 })],
  ["maxRetries: 1.5", () => new Client({ maxRetries: 1.5 })],
  ["retryDelayMs: 3e9", () => new Client({ retryDelayMs: 3_000_000_000 })],
  ["baseUrl: 5", () => new Client({ baseUrl: 5 as unknown as string })],
  ["userAgent: {}", () => new Client({ userAgent: {} as unknown as string })],
  ["transport: 'x'", () => new Client({ transport: "x" as unknown as never })],
  ["sleep: 5", () => new Client({ sleep: 5 as unknown as never })],
];
// --------------------------------------------------------------------------------------

const respond = (body: Buffer, contentType: string) => async (): Promise<HttpResponse> => ({
  status: 200,
  headers: { "content-type": contentType },
  body,
});

test("P8: a body is decoded by its declared charset", async () => {
  const text = "Müller µg/l";
  for (const [charset, encoding] of [["iso-8859-1", "latin1"], ["utf-8", "utf8"]] as const) {
    const body = Buffer.from(JSON.stringify(textBody(text)), encoding);
    const client = new Client({ transport: respond(body, `application/json; charset=${charset}`) });
    assert.equal(readText(await textCall(client)), text, charset);
  }
});

test("P9: a 2xx body without the documented shape is a parse error", async () => {
  for (const body of malformedBodies) {
    const client = new Client({ transport: respond(Buffer.from(JSON.stringify(body)), "application/json"), maxRetries: 0 });
    await assert.rejects(textCall(client), ParseError, `body ${JSON.stringify(body)}`);
  }
  for (const raw of ["", "<html>maintenance</html>"]) {
    const client = new Client({ transport: respond(Buffer.from(raw), "text/html"), maxRetries: 0 });
    await assert.rejects(textCall(client), BaseError, `raw ${JSON.stringify(raw)}`);
  }
});

test("P13: every rejected input is the validation error, never a raw TypeError", async () => {
  for (const [label, fn] of badCalls) {
    await assert.rejects(async () => fn(), (e: unknown) => e instanceof ValidationError, label);
  }
});
