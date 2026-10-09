// CLI <-> library parity: the same input through run() and through the library
// call must give the same outcome — both reject before any request, or both send
// the identical request.

import { test } from "node:test";
import assert from "node:assert/strict";
import { TagesschauClient } from "../src/client/client.js";
import { TagesschauNetworkError, TagesschauValidationError } from "../src/client/errors.js";
import { parity, type LibOutcome } from "./helpers.js";

/** The library rejected with TagesschauValidationError and sent nothing. */
function assertLibRejected(lib: LibOutcome, message: string | RegExp, label: string): void {
  assert.equal(lib.ok, false, `${label}: library resolved`);
  assert.equal(lib.requests.length, 0, `${label}: library sent a request`);
  if (!lib.ok) {
    assert.ok(lib.error instanceof TagesschauValidationError, `${label}: ${String(lib.error)}`);
    if (typeof message === "string") assert.equal((lib.error as Error).message, message, label);
    else assert.match((lib.error as Error).message, message, label);
  }
}

test("parity: blank search text is rejected by the CLI and the library alike (finding #3)", async () => {
  for (const text of ["", " ", "   ", "\t\n", "　"]) {
    const { cli, lib } = await parity(["--compact", "search", text], (transport) =>
      new TagesschauClient({ transport }).search({ searchText: text }),
    );
    const label = JSON.stringify(text);
    assert.equal(cli.code, 1, label);
    assert.equal(cli.requests.length, 0, label);
    assert.equal(cli.err, "ERROR [tagesschau.cli] search text must not be empty.", label);
    assertLibRejected(lib, "search text must not be empty.", label);
  }
});

test("parity: a missing search text is rejected by the library before any request (finding #3)", async () => {
  for (const params of [undefined, {}, { pageSize: 5 }]) {
    const { cli, lib } = await parity(["--compact", "search"], (transport) =>
      // A JS caller can omit the text the type requires.
      new TagesschauClient({ transport }).search(params as never),
    );
    assert.equal(cli.code, 1);
    assert.equal(cli.requests.length, 0);
    assertLibRejected(lib, "search text must not be empty.", JSON.stringify(params));
  }
});

test("parity: a padded search text is sent the same way by both (finding #3 control)", async () => {
  const { cli, lib } = await parity(["--compact", "search", " Wahl "], (transport) =>
    new TagesschauClient({ transport }).search({ searchText: " Wahl " }),
  );
  assert.equal(cli.code, 0);
  assert.equal(lib.ok, true);
  assert.deepEqual(
    cli.requests.map((r) => r.url),
    lib.requests.map((r) => r.url),
  );
});

const REGION_MSG = (v: string) =>
  `Invalid region "${v}". Expected one of: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16.`;
const RESSORT_MSG = (v: string) =>
  `Invalid ressort "${v}". Expected one of: inland, ausland, wirtschaft, sport, video, investigativ, wissen.`;

test("parity: a region outside 1..16 is rejected by the CLI and the library alike (finding #1)", async () => {
  for (const region of ["17", "0", "", " 9", "09", "9,10", "1e1"]) {
    const { cli, lib } = await parity(["--compact", "news", `--region=${region}`], (transport) =>
      new TagesschauClient({ transport }).news({ regions: [region] as never }),
    );
    const label = JSON.stringify(region);
    assert.equal(cli.code, 1, label);
    assert.equal(cli.requests.length, 0, label);
    assert.equal(cli.err, `ERROR [tagesschau.cli] ${REGION_MSG(region)}`, label);
    assertLibRejected(lib, REGION_MSG(region), label);
  }
});

test("parity: a ressort outside the seven Ressorts is rejected by the CLI and the library alike (finding #1)", async () => {
  for (const ressort of ["Wirtschaft", "", "  ", " wirtschaft", "bogus"]) {
    const { cli, lib } = await parity(["--compact", "news", `--ressort=${ressort}`], (transport) =>
      new TagesschauClient({ transport }).news({ ressort: ressort as never }),
    );
    const label = JSON.stringify(ressort);
    assert.equal(cli.code, 1, label);
    assert.equal(cli.requests.length, 0, label);
    assert.equal(cli.err, `ERROR [tagesschau.cli] ${RESSORT_MSG(ressort)}`, label);
    assertLibRejected(lib, RESSORT_MSG(ressort), label);
  }
});

test("parity: valid regions and ressorts send the same request on both sides (finding #1 control)", async () => {
  for (const [argv, params] of [
    [["news", "--region=9"], { regions: ["9"] }],
    [["news", "--region=5", "--region=16"], { regions: ["5", "16"] }],
    [["news", "--ressort=wirtschaft"], { ressort: "wirtschaft" }],
  ] as const) {
    const { cli, lib } = await parity(["--compact", ...argv], (transport) =>
      new TagesschauClient({ transport }).news(params as never),
    );
    assert.equal(cli.code, 0, argv.join(" "));
    assert.equal(lib.ok, true, argv.join(" "));
    assert.deepEqual(
      cli.requests.map((r) => r.url),
      lib.requests.map((r) => r.url),
    );
  }
});

test("parity: pageSize outside 1..2^31-1 is rejected by the CLI and the library alike (finding #2)", async () => {
  for (const [arg, value] of [
    ["0", 0],
    ["-1", -1],
    ["1.5", 1.5],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["2147483648", 2147483648],
  ] as const) {
    const { cli, lib } = await parity(["--compact", "search", "Wahl", `--page-size=${arg}`], (transport) =>
      new TagesschauClient({ transport }).search({ searchText: "Wahl", pageSize: value }),
    );
    assert.equal(cli.code, 1, arg);
    assert.equal(cli.requests.length, 0, arg);
    assertLibRejected(
      lib,
      `Invalid pageSize: expected an integer from 1 to 2147483647, got ${String(value)}.`,
      arg,
    );
  }
});

test("parity: resultPage outside 0..2^31-1 is rejected by the CLI and the library alike (finding #2)", async () => {
  for (const [arg, value] of [
    ["-1", -1],
    ["1.5", 1.5],
    ["2147483648", 2147483648],
    ["99999999999999999999", 99999999999999999999],
  ] as const) {
    const { cli, lib } = await parity(["--compact", "search", "Wahl", `--result-page=${arg}`], (transport) =>
      new TagesschauClient({ transport }).search({ searchText: "Wahl", resultPage: value }),
    );
    assert.equal(cli.code, 1, arg);
    assert.equal(cli.requests.length, 0, arg);
    assertLibRejected(lib, /^Invalid resultPage: expected an integer from 0 to 2147483647, got /, arg);
  }
});

test("parity: in-range paging sends the same request on both sides (finding #2 control)", async () => {
  for (const [argv, params] of [
    [["--page-size=1", "--result-page=0"], { pageSize: 1, resultPage: 0 }],
    [["--page-size=2147483647", "--result-page=2147483647"], { pageSize: 2147483647, resultPage: 2147483647 }],
  ] as const) {
    const { cli, lib } = await parity(["--compact", "search", "Wahl", ...argv], (transport) =>
      new TagesschauClient({ transport }).search({ searchText: "Wahl", ...params }),
    );
    assert.equal(cli.code, 0, argv.join(" "));
    assert.equal(lib.ok, true, argv.join(" "));
    assert.deepEqual(
      cli.requests.map((r) => r.url),
      lib.requests.map((r) => r.url),
    );
  }
});

test("parity: a base URL with surrounding whitespace is rejected by the CLI and the library alike (finding #4)", async () => {
  for (const baseUrl of [
    "https://www.tagesschau.de/ ",
    "https://www.tagesschau.de ",
    " https://www.tagesschau.de",
    "https://h.example/p\t",
    "https://h.example/p\n",
  ]) {
    const { cli, lib } = await parity(["--compact", "--base-url", baseUrl, "channels"], (transport) =>
      new TagesschauClient({ transport, baseUrl }).channels(),
    );
    const label = JSON.stringify(baseUrl);
    assert.equal(cli.code, 1, label);
    assert.equal(cli.requests.length, 0, label);
    assert.match(cli.err, /A base URL cannot have surrounding whitespace\./, label);
    assertLibRejected(lib, "Invalid baseUrl: A base URL cannot have surrounding whitespace.", label);
  }
});

test("parity: a base URL with inner whitespace or controls is rejected by the CLI and the library alike (finding #4)", async () => {
  for (const baseUrl of ["https://h.example/a b", "https://h.example/a\tb", "https://h.example/a\u0000b"]) {
    const { cli, lib } = await parity(["--compact", "--base-url", baseUrl, "channels"], (transport) =>
      new TagesschauClient({ transport, baseUrl }).channels(),
    );
    const label = JSON.stringify(baseUrl);
    assert.equal(cli.code, 1, label);
    assert.equal(cli.requests.length, 0, label);
    assert.match(cli.err, /A base URL cannot contain whitespace or control characters\./, label);
    assertLibRejected(lib, "Invalid baseUrl: A base URL cannot contain whitespace or control characters.", label);
  }
});

test("parity: an invalid base URL is one rule set, a validation error on both sides (finding #6)", async () => {
  for (const [baseUrl, reason] of [
    ["ftp://h.example", 'Unsupported scheme "ftp:". Expected an http(s) URL.'],
    ["file:///etc/passwd", 'Unsupported scheme "file:". Expected an http(s) URL.'],
    ["https://h.example/?q=1", "A base URL cannot have a query (?) or fragment (#)."],
    ["https://h.example/#f", "A base URL cannot have a query (?) or fragment (#)."],
    ["notaurl", "Expected an absolute http(s) URL."],
    ["not a url", "A base URL cannot contain whitespace or control characters."],
    ["", "Expected an absolute http(s) URL."],
    ["   ", "Expected an absolute http(s) URL."],
  ] as const) {
    const { cli, lib } = await parity(["--compact", "--base-url", baseUrl, "channels"], (transport) =>
      new TagesschauClient({ transport, baseUrl }).channels(),
    );
    const label = JSON.stringify(baseUrl);
    assert.equal(cli.code, 1, label);
    assert.equal(cli.requests.length, 0, label);
    assert.match(cli.err, new RegExp(`is invalid\\. ${reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), label);
    assertLibRejected(lib, `Invalid baseUrl: ${reason}`, label);
    assert.ok(!(lib.ok === false && lib.error instanceof TagesschauNetworkError), `${label}: a network error`);
  }
});

test("parity: a blank User-Agent is rejected by the CLI and the library alike (finding #5)", async () => {
  for (const userAgent of ["", " ", "   ", "\t"]) {
    const { cli, lib } = await parity(["--compact", "--user-agent", userAgent, "channels"], (transport) =>
      new TagesschauClient({ transport, userAgent }).channels(),
    );
    const label = JSON.stringify(userAgent);
    assert.equal(cli.code, 1, label);
    assert.equal(cli.requests.length, 0, label);
    assert.match(cli.err, /is invalid\. Expected a non-empty value\./, label);
    assertLibRejected(lib, "Invalid userAgent: Expected a non-empty value.", label);
  }
});

test("parity: one header-value rule for the User-Agent on both sides (finding #5)", async () => {
  for (const [userAgent, reason] of [
    ["a\r\nb", "Value contains control characters."],
    ["a\u0000b", "Value contains control characters."],
    ["a\u007fb", "Value contains control characters."],
    ["Tagesschau€", "Value contains characters outside Latin-1 (above U+00FF)."],
  ] as const) {
    const { cli, lib } = await parity(["--compact", "--user-agent", userAgent, "channels"], (transport) =>
      new TagesschauClient({ transport, userAgent }).channels(),
    );
    const label = JSON.stringify(userAgent);
    assert.equal(cli.code, 1, label);
    assert.equal(cli.requests.length, 0, label);
    assert.match(cli.err, new RegExp(`is invalid\\. ${reason.replace(/[.()+]/g, "\\$&")}`), label);
    assertLibRejected(lib, `Invalid userAgent: ${reason}`, label);
  }
  for (const userAgent of [" my-app/1.0 ", "a\tb", "Müller"]) {
    const { cli, lib } = await parity(["--compact", "--user-agent", userAgent, "channels"], (transport) =>
      new TagesschauClient({ transport, userAgent }).channels(),
    );
    assert.equal(cli.code, 0, userAgent);
    assert.equal(lib.ok, true, userAgent);
    assert.equal(cli.requests[0]?.headers?.["User-Agent"], userAgent);
    assert.equal(lib.requests[0]?.headers?.["User-Agent"], userAgent);
  }
});
