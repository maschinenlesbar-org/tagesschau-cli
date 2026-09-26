import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli/run.js";
import { TagesschauClient } from "../src/client/client.js";
import type { CliDeps } from "../src/cli/io.js";
import type { HttpRequest, HttpResponse } from "../src/client/http.js";
import { makeMockTransport, jsonResponse } from "./helpers.js";

function makeCli(responder: (req: HttpRequest) => HttpResponse) {
  const out: string[] = [];
  const err: string[] = [];
  const mt = makeMockTransport(responder);

  const deps: CliDeps = {
    io: {
      out: (s) => out.push(s),
      err: (s) => err.push(s),
    },
    createClient: (opts) => new TagesschauClient({ ...opts, transport: mt.transport }),
  };
  return { deps, out, err, mt };
}

test("homepage hits the right path", async () => {
  const cli = makeCli(() => jsonResponse({ news: [], regional: [] }));
  const code = await run(["homepage"], cli.deps);
  assert.equal(code, 0);
  assert.equal(new URL(cli.mt.last().url).pathname, "/api2u/homepage/");
});

test("news: repeatable --region builds the query; --ressort alone too", async () => {
  const cli = makeCli(() => jsonResponse({ news: [], regional: [] }));
  assert.equal(await run(["news", "--region", "1", "--region", "9"], cli.deps), 0);
  assert.equal(new URL(cli.mt.last().url).searchParams.get("regions"), "1,9");

  const ress = makeCli(() => jsonResponse({ news: [], regional: [] }));
  assert.equal(await run(["news", "--ressort", "sport"], ress.deps), 0);
  assert.equal(new URL(ress.mt.last().url).searchParams.get("ressort"), "sport");
});

test("news --ressort with --region is refused before any request (the API drops the region)", async () => {
  for (const argv of [
    ["news", "--ressort", "inland", "--region", "2"],
    ["news", "--region", "5", "--region", "9", "--ressort", "wirtschaft"],
  ]) {
    const cli = makeCli(() => jsonResponse({ news: [], regional: [] }));
    assert.equal(await run(argv, cli.deps), 1, argv.join(" "));
    assert.equal(cli.mt.calls.length, 0);
    assert.match(cli.err.join("\n"), /^Error: --ressort and --region cannot be combined/);
  }
});

test("news rejects an invalid ressort before any request", async () => {
  const cli = makeCli(() => jsonResponse({}));
  const code = await run(["news", "--ressort", "klatsch"], cli.deps);
  assert.notEqual(code, 0);
  assert.equal(cli.mt.calls.length, 0);
  assert.match(cli.err.join("\n"), /Invalid ressort/);
});

test("news rejects an out-of-range region before any request", async () => {
  const cli = makeCli(() => jsonResponse({}));
  const code = await run(["news", "--region", "99"], cli.deps);
  assert.notEqual(code, 0);
  assert.equal(cli.mt.calls.length, 0);
});

test("search passes the text and paging options", async () => {
  const cli = makeCli(() => jsonResponse({ searchResults: [] }));
  await run(["search", "Wahl", "--result-page", "3"], cli.deps);
  const url = new URL(cli.mt.last().url);
  assert.equal(url.searchParams.get("searchText"), "Wahl");
  assert.equal(url.searchParams.get("resultPage"), "3");
});

test("search sends a decomposed umlaut composed (NFKC)", async () => {
  const cli = makeCli(() => jsonResponse({ searchResults: [] }));
  assert.equal(await run(["search", "Ko\u0308ln"], cli.deps), 0);
  assert.match(cli.mt.last().url, /searchText=K%C3%B6ln(&|$)/);
});

test("search accepts --result-page 0 (the API's first page) but still rejects --page-size 0", async () => {
  const cli = makeCli(() => jsonResponse({ searchResults: [] }));
  assert.equal(await run(["search", "Wahl", "--result-page", "0"], cli.deps), 0);
  assert.equal(new URL(cli.mt.last().url).searchParams.get("resultPage"), "0");

  const bad = makeCli(() => jsonResponse({ searchResults: [] }));
  assert.equal(await run(["search", "Wahl", "--page-size", "0"], bad.deps), 1);
  assert.equal(bad.mt.calls.length, 0);
  assert.match(bad.err.join("\n"), />= 1/);

  const negative = makeCli(() => jsonResponse({ searchResults: [] }));
  assert.equal(await run(["search", "Wahl", "--result-page", "-1"], negative.deps), 1);
  assert.equal(negative.mt.calls.length, 0);
});

test("--page-size and --result-page are bounded to the API's 32-bit int", async () => {
  for (const argv of [
    ["search", "Wahl", "--result-page", "2147483648"],
    ["search", "Wahl", "--result-page", "9007199254740993"],
    ["search", "Wahl", "--page-size", "2147483648"],
  ]) {
    const cli = makeCli(() => jsonResponse({ searchResults: [] }));
    assert.equal(await run(argv, cli.deps), 1, argv.join(" "));
    assert.equal(cli.mt.calls.length, 0);
    assert.match(cli.err.join("\n"), /Expected an integer <= 2147483647\./);
  }
  const ok = makeCli(() => jsonResponse({ searchResults: [] }));
  assert.equal(await run(["search", "Wahl", "--result-page", "2147483647", "--page-size", "2147483647"], ok.deps), 0);
});

test("DEL and C1 control characters in server data are escaped in the JSON output", async () => {
  const controls = String.fromCharCode(0x7f, 0x85, 0x9b) + "2J";
  const served = {
    news: [{ title: `Nachricht${controls}`, topline: String.fromCharCode(0x1b) + "[31m" }],
    regional: [],
  };
  for (const format of [[], ["--compact"]]) {
    const cli = makeCli(() => jsonResponse(served));
    assert.equal(await run([...format, "homepage"], cli.deps), 0);
    const text = cli.out.join("\n");
    const raw = [...text].filter((c) =>
      c.charCodeAt(0) < 0x20 ? c !== "\n" : c.charCodeAt(0) >= 0x7f && c.charCodeAt(0) <= 0x9f,
    );
    assert.deepEqual(raw, [], format.join(" "));
    assert.match(text, /Nachricht\\u007f\\u0085\\u009b2J/);
    assert.deepEqual(JSON.parse(text), served);
  }
});

test("--timeout accepts up to the largest timer Node supports", async () => {
  const cli = makeCli(() => jsonResponse({ news: [], regional: [] }));
  assert.equal(await run(["--timeout", "2147483647", "homepage"], cli.deps), 0);
  assert.equal(cli.mt.last().timeoutMs, 2_147_483_647);

  const over = makeCli(() => jsonResponse({ news: [], regional: [] }));
  assert.equal(await run(["--timeout", "2147483648", "homepage"], over.deps), 1);
  assert.equal(over.mt.calls.length, 0); // rejected before any request
  assert.match(over.err.join("\n"), /<= 2147483647/);
});

test("a 404 from the API maps to exit code 4", async () => {
  const cli = makeCli(() => jsonResponse({}, 404));
  const code = await run(["channels"], cli.deps);
  assert.equal(code, 4);
});

test("--base-url with a query, fragment or surrounding whitespace is a usage error", async () => {
  const cases: Array<[string, RegExp]> = [
    ["http://127.0.0.1:1/echo?x=1", /query \(\?\) or fragment \(#\)/],
    ["http://127.0.0.1:1/echo#frag", /query \(\?\) or fragment \(#\)/],
    [" https://example.test", /surrounding whitespace/],
    ["https://example.test ", /surrounding whitespace/],
  ];
  for (const [url, message] of cases) {
    const cli = makeCli(() => jsonResponse({ news: [], regional: [] }));
    assert.equal(await run(["--base-url", url, "news"], cli.deps), 1, url);
    assert.equal(cli.mt.calls.length, 0);
    assert.match(cli.err.join("\n"), message);
  }
  const prefix = makeCli(() => jsonResponse({ news: [], regional: [] }));
  assert.equal(await run(["--base-url", "https://mirror.test/ts/", "news"], prefix.deps), 0);
  assert.equal(prefix.mt.last().url, "https://mirror.test/ts/api2u/news/");
});

test("--base-url rejects a non-http(s) or malformed URL at parse time, before any request", async () => {
  for (const bad of ["file:///etc/passwd", "ftp://example.org", "notaurl"]) {
    const cli = makeCli(() => jsonResponse({ news: [], regional: [] }));
    const code = await run(["--base-url", bad, "homepage"], cli.deps);
    assert.notEqual(code, 0, `expected a non-zero exit for --base-url ${bad}`);
    assert.equal(cli.mt.calls.length, 0, `no request may be sent for --base-url ${bad}`);
    assert.match(cli.err.join("\n"), /--base-url/);
  }
});

test("--max-retries is bounded to 0..10", async () => {
  for (const bad of ["11", "99999999999"]) {
    const cli = makeCli(() => jsonResponse({ channels: [] }));
    assert.equal(await run(["--max-retries", bad, "channels"], cli.deps), 1, bad);
    assert.equal(cli.mt.calls.length, 0);
    assert.match(cli.err.join("\n"), /<= 10/);
  }
  const ok = makeCli(() => jsonResponse({ channels: [] }));
  assert.equal(await run(["--max-retries", "10", "channels"], ok.deps), 0);
});

test("--max-redirects is bounded to 0..20", async () => {
  const cli = makeCli(() => jsonResponse({ channels: [] }));
  assert.equal(await run(["--max-redirects", "21", "channels"], cli.deps), 1);
  assert.equal(cli.mt.calls.length, 0);
  assert.match(cli.err.join("\n"), /<= 20/);
  const ok = makeCli(() => jsonResponse({ channels: [] }));
  assert.equal(await run(["--max-redirects", "20", "channels"], ok.deps), 0);
});

test("userinfo in --base-url is sent but redacted in error messages", async () => {
  const cli = makeCli(() => jsonResponse({ detail: "nicht gefunden" }, 404));
  const code = await run(["--base-url", "http://user:s3cret@127.0.0.1:1", "news"], cli.deps);
  assert.equal(code, 4);
  assert.ok(cli.mt.last().url.includes("user:s3cret@"));
  const text = cli.err.join("\n");
  assert.doesNotMatch(text, /s3cret/);
  assert.equal(text, "Error: HTTP 404 for GET http://***@127.0.0.1:1/api2u/news/: nicht gefunden");
});

test("--user-agent: blank, control characters and non-Latin-1 are usage errors before any request", async () => {
  const cases: Array<[string, RegExp]> = [
    ["", /Expected a non-empty value/],
    ["   ", /Expected a non-empty value/],
    ["a\nb", /Value contains control characters/],
    ["x\r\nX-Inject: 1", /Value contains control characters/],
    ["a\u007fb", /Value contains control characters/],
    ["Tagesschau\u20ac", /outside Latin-1/],
  ];
  for (const [ua, message] of cases) {
    const cli = makeCli(() => jsonResponse({ channels: [] }));
    assert.equal(await run(["--user-agent", ua, "channels"], cli.deps), 1, JSON.stringify(ua));
    assert.equal(cli.mt.calls.length, 0);
    assert.match(cli.err.join("\n"), message);
    assert.doesNotMatch(cli.err.join("\n"), /Unexpected error/);
  }
  for (const ua of ["a\tb", "M\u00fcller/1.0"]) {
    const cli = makeCli(() => jsonResponse({ channels: [] }));
    assert.equal(await run(["--user-agent", ua, "channels"], cli.deps), 0, JSON.stringify(ua));
    assert.equal(cli.mt.last().headers?.["User-Agent"], ua);
  }
});

test("a deeply nested response is a clear error, not a stack overflow", async () => {
  const deep = '{"news":[' + "[".repeat(200_000) + "]".repeat(200_000) + '],"regional":[]}';
  const respond = () => ({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(deep) });
  const pretty = makeCli(respond);
  assert.equal(await run(["news"], pretty.deps), 1);
  assert.deepEqual(pretty.err, ["Error: The response is nested too deeply to pretty-print; try --compact."]);
  const compact = makeCli(respond);
  const code = await run(["--compact", "news"], compact.deps);
  if (code !== 0) {
    assert.equal(code, 1);
    assert.deepEqual(compact.err, ["Error: The response is nested too deeply to print."]);
  }
});

test("a null 2xx body is an error (exit 1), not `null` with exit 0", async () => {
  const cli = makeCli(() => jsonResponse(null));
  assert.equal(await run(["--compact", "news"], cli.deps), 1);
  assert.deepEqual(cli.out, []);
  assert.deepEqual(cli.err, ['Error: Unexpected response shape from /api2u/news/: expected a JSON object with a "news" array.']);
});

test("bidi formatting characters in server data are escaped in the JSON output", async () => {
  const served = { news: [{ title: `a${String.fromCharCode(0x202e)}b${String.fromCharCode(0x2066)}c` }], regional: [] };
  const cli = makeCli(() => jsonResponse(served));
  assert.equal(await run(["--compact", "news"], cli.deps), 0);
  assert.match(cli.out.join(""), /a\\u202eb\\u2066c/);
  assert.deepEqual(JSON.parse(cli.out.join("")), served);
});
