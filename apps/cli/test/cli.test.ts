import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli/run.js";
import { forbidRepeatedOptions, renderJson } from "../src/cli/shared.js";
import { buildProgram } from "../src/cli/program.js";
import { TagesschauClient } from "@maschinenlesbar.org/tagesschau-client/internal/client";
import { credentialsIn } from "@maschinenlesbar.org/tagesschau-client/internal/errors";
import type { CliDeps } from "../src/cli/io.js";
import type { HttpRequest, HttpResponse } from "@maschinenlesbar.org/tagesschau-client/internal/http";
import { makeMockTransport, jsonResponse, untimed } from "./helpers.js";

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

test("news --region 17 --help prints the help and exits 0; --region 17 alone is still a usage error", async () => {
  for (const argv of [["news", "--region", "17", "--help"], ["news", "--help", "--region", "0"], ["news", "-h", "--region", "x"]]) {
    const cli = makeCli(() => jsonResponse({ news: [], regional: [] }));
    assert.equal(await run(argv, cli.deps), 0, argv.join(" "));
    assert.match(cli.out.join("\n"), /^Usage: tagesschau news /, argv.join(" "));
    assert.deepEqual(cli.err, [], argv.join(" "));
    assert.equal(cli.mt.calls.length, 0);
  }
  const bad = makeCli(() => jsonResponse({ news: [], regional: [] }));
  assert.equal(await run(["news", "--region", "17"], bad.deps), 1);
  assert.equal(bad.mt.calls.length, 0);
  assert.match(untimed(bad.err[0] ?? ""), /^ERROR \[tagesschau\.cli\] /);
});

test("news --ressort with --region is refused before any request (the API drops the region)", async () => {
  for (const argv of [
    ["news", "--ressort", "inland", "--region", "2"],
    ["news", "--region", "5", "--region", "9", "--ressort", "wirtschaft"],
  ]) {
    const cli = makeCli(() => jsonResponse({ news: [], regional: [] }));
    assert.equal(await run(argv, cli.deps), 1, argv.join(" "));
    assert.equal(cli.mt.calls.length, 0);
    assert.match(untimed(cli.err.join("\n")), /^ERROR \[tagesschau\.cli\] --ressort and --region cannot be combined/);
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

test("userinfo in --base-url is sent as Basic auth and kept out of error messages", async () => {
  const cli = makeCli(() => jsonResponse({ detail: "nicht gefunden" }, 404));
  const code = await run(["--base-url", "http://user:s3cret@127.0.0.1:1", "news"], cli.deps);
  assert.equal(code, 4);
  assert.equal(cli.mt.last().url, "http://127.0.0.1:1/api2u/news/");
  assert.equal(cli.mt.last().headers?.["Authorization"], `Basic ${Buffer.from("user:s3cret").toString("base64")}`);
  const text = cli.err.join("\n");
  assert.doesNotMatch(text, /s3cret/);
  assert.equal(untimed(text), "ERROR [tagesschau.api] HTTP 404 for GET http://127.0.0.1:1/api2u/news/: nicht gefunden");
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

test("an answer nested too deeply is a clean error; it suggests --compact only where --compact prints it (D7)", async () => {
  // A hostile or broken answer, deep inside a well-shaped envelope (so the shape check passes):
  // JSON.parse reads it, the pretty printer's recursion can't. Whether the compact printer can
  // depends on the Node version (iterative from Node 26) and the stack: probed here, never assumed.
  const depth = 200_000;
  const deep = '{"news":[' + "[".repeat(depth) + "]".repeat(depth) + '],"regional":[]}';
  let compactPrints = true;
  try {
    JSON.stringify(JSON.parse(deep));
  } catch {
    compactPrints = false;
  }
  const respond = () => ({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(deep) });
  const pretty = makeCli(respond);
  assert.equal(await run(["news"], pretty.deps), 1);
  assert.deepEqual(pretty.out, []);
  assert.deepEqual(pretty.err.map(untimed), [
    `ERROR [tagesschau.output] The answer is nested too deeply to pretty-print${compactPrints ? "; try --compact" : ""}.`,
  ]);
  const compact = makeCli(respond);
  assert.equal(await run(["--compact", "news"], compact.deps), compactPrints ? 0 : 1);
  if (!compactPrints) assert.deepEqual(compact.err.map(untimed), ["ERROR [tagesschau.output] The answer is nested too deeply to print."]);
});

test("an answer too large to print is called too large, not too deep; the hint only where --compact prints (D7)", (t) => {
  // A large but shallow answer that pretty-prints past V8's longest string was reported as
  // "nested too deeply". V8's own error for such a text, stood in for: a real one needs 512 MB.
  const { deps } = makeCli(() => jsonResponse([]));
  const real = JSON.stringify;
  const tooLarge = (gap: unknown): boolean => gap === 2 || gap === "big";
  t.mock.method(JSON, "stringify", (value: unknown, replacer: never, gap: unknown) => {
    if (tooLarge(gap) || (gap === undefined && (value as { all?: boolean }).all === true)) throw new RangeError("Invalid string length");
    return real(value, replacer, gap as number);
  });
  assert.throws(() => renderJson(deps, {}, { id: "a1" }), (err: Error) =>
    /^The answer is too large \(more than \d+ characters of JSON\) to pretty-print; try --compact\.$/.test(err.message));
  assert.throws(() => renderJson(deps, {}, { all: true }), (err: Error) =>
    /^The answer is too large \(more than \d+ characters of JSON\) to pretty-print\.$/.test(err.message));
  assert.throws(() => renderJson(deps, { compact: true }, { all: true }), (err: Error) =>
    /^The answer is too large \(more than \d+ characters of JSON\) to print\.$/.test(err.message));
});

test("--compact takes the gap path only for an answer holding a huge string, the fast path otherwise", (t) => {
  // On Node 26 V8's fast stringifier (no gap) aborts the process on a ~250 MB string that
  // JSON.parse made ("Zone Allocation failed", exit 134); the gap path prints it. Only the fast
  // path is iterative there, though, and prints nesting the gap path refuses at ~7,000 levels.
  // So the path is chosen per answer. Too big a body for this suite: this pins the calls.
  const { deps, out } = makeCli(() => jsonResponse({}));
  const stringify = t.mock.method(JSON, "stringify", () => '"stub"');
  const huge = "x".repeat(64 * 1024 * 1024);
  renderJson(deps, { compact: true }, { id: "a1", text: huge });
  renderJson(deps, { compact: true }, { id: "a1", x: [[["Rede"]]], text: huge.slice(1) });
  renderJson(deps, { compact: true }, { [huge]: 1 });
  renderJson(deps, { compact: true }, [[huge]]);
  renderJson(deps, {}, { id: "a1" });
  const calls = stringify.mock.calls.map((call) => call.arguments);
  stringify.mock.restore();
  assert.deepEqual(calls.map((args) => (args.length >= 3 ? args[2] : "none")), ["", "none", "", "", 2]);
  assert.deepEqual(out, ['"stub"', '"stub"', '"stub"', '"stub"', '"stub"']);
});

test("a null 2xx body is an error (exit 1), not `null` with exit 0", async () => {
  const cli = makeCli(() => jsonResponse(null));
  assert.equal(await run(["--compact", "news"], cli.deps), 1);
  assert.deepEqual(cli.out, []);
  assert.deepEqual(cli.err.map(untimed), ['ERROR [tagesschau.api] GET https://www.tagesschau.de/api2u/news/: unexpected response shape: expected a JSON object with a "news" array.']);
});

test("bidi formatting characters in server data are escaped in the JSON output", async () => {
  const served = { news: [{ title: `a${String.fromCharCode(0x202e)}b${String.fromCharCode(0x2066)}c` }], regional: [] };
  const cli = makeCli(() => jsonResponse(served));
  assert.equal(await run(["--compact", "news"], cli.deps), 0);
  assert.match(cli.out.join(""), /a\\u202eb\\u2066c/);
  assert.deepEqual(JSON.parse(cli.out.join("")), served);
});

test("news --date follows the nextPage cursor; a malformed one is a usage error", async () => {
  const cli = makeCli(() => jsonResponse({ news: [], regional: [] }));
  assert.equal(await run(["news", "--ressort", "inland", "--date", "260920"], cli.deps), 0);
  const url = new URL(cli.mt.last().url);
  assert.equal(url.searchParams.get("date"), "260920");
  assert.equal(url.searchParams.get("ressort"), "inland");

  const bad = makeCli(() => jsonResponse({ news: [], regional: [] }));
  assert.equal(await run(["news", "--date", "2026-09-20"], bad.deps), 1);
  assert.equal(bad.mt.calls.length, 0);
  assert.match(bad.err.join("\n"), /Invalid date "2026-09-20": expected YYMMDD/);
});

test("search notes on stderr that an ASCII transliteration is matched literally", async () => {
  const hinted = ["Strasse", "Koeln", "Muenchen", "Baerbock", "Russland"];
  const plain = ["Straße", "Köln", "Bundestag", "Steuer", "neue Quelle", "Bauer"];
  for (const text of [...hinted, ...plain]) {
    const cli = makeCli(() => jsonResponse({ searchResults: [], totalItemCount: 0 }));
    assert.equal(await run(["search", text], cli.deps), 0, text);
    assert.equal(cli.mt.calls.length, 1);
    const note = cli.err.join("\n");
    if (hinted.includes(text)) {
      assert.match(untimed(note), /^INFO  \[tagesschau\.api\] the search matches spellings literally .*search that spelling too\.$/, text);
      if (!["Strasse", "Koeln"].includes(text)) assert.ok(!note.includes(text), "the note never repeats the text");
    } else {
      assert.equal(note, "", text);
    }
    assert.equal(cli.out.length, 1, "the JSON on stdout is unchanged");
  }
});

test("an a:b@c search text or User-Agent is neither a credential in the log nor rewritten in the JSON on stdout (L14)", async () => {
  const text = "Bundesliga:Bayern gegen Dortmund@Allianz Arena";
  const body = { searchResults: [{ title: `${text}: 2:1` }], searchText: text, totalItemCount: 1 };
  const search = makeCli(() => jsonResponse(body));
  assert.equal(await run(["search", text], search.deps), 0, search.err.join("\n"));
  assert.equal(new URL(search.mt.last().url).searchParams.get("searchText"), text);
  assert.match(search.out.join("\n"), /"searchText": "Bundesliga:Bayern gegen Dortmund@Allianz Arena"/);
  assert.match(search.out.join("\n"), /"title": "Bundesliga:Bayern gegen Dortmund@Allianz Arena: 2:1"/);
  const ua = makeCli(() => jsonResponse({ news: [{ title: "Zeit:Online@Mitte" }], regional: [] }));
  assert.equal(await run(["--user-agent", "Zeit:Online@Mitte", "news"], ua.deps), 0);
  assert.match(ua.out.join("\n"), /"title": "Zeit:Online@Mitte"/);
  assert.deepEqual(credentialsIn("Zeit:Online@Mitte"), []);
  assert.deepEqual(credentialsIn("https://alice:pw@host"), ["alice:pw"]);
  // A base URL typed without its scheme is still read as one: its password is never echoed.
  const bare = makeCli(() => jsonResponse(body));
  assert.equal(await run(["--base-url", "alice:hunter2-pw@mirror.example", "channels"], bare.deps), 1);
  assert.ok(!bare.err.join("\n").includes("hunter2-pw"), bare.err.join("\n"));
});

test("the help after a usage error is one INFO record per line; a suggestion is part of the ERROR (L5)", async () => {
  const cli = makeCli(() => jsonResponse({ channels: [] }));
  assert.equal(await run(["channels", "--no-such-option"], cli.deps), 1);
  const records = cli.err.map(untimed);
  assert.equal(records[0], "ERROR [tagesschau.cli] unknown option '--no-such-option'");
  assert.ok(records.length > 3, records.join("\n"));
  for (const record of records.slice(1)) {
    assert.match(record, /^INFO  \[tagesschau\.cli\] .*\S$/);
    assert.doesNotMatch(record, /\\n/, "one line of the help per record");
  }
  const typo = makeCli(() => jsonResponse({ channels: [] }));
  assert.equal(await run(["hompage"], typo.deps), 1);
  assert.equal(untimed(typo.err[0] ?? ""), "ERROR [tagesschau.cli] unknown command 'hompage' (Did you mean homepage?)");
});

test("help for an unknown command, or global options with no command, is a failed run with an ERROR first (L5)", async () => {
  for (const argv of [["help", "hompage"], ["--compact"]]) {
    const cli = makeCli(() => jsonResponse({ channels: [] }));
    assert.equal(await run(argv, cli.deps), 1, argv.join(" "));
    const records = cli.err.map(untimed);
    assert.equal(records[0], "ERROR [tagesschau.cli] missing command: `tagesschau <subcommand>`", argv.join(" "));
    assert.ok(records.length > 3, records.join("\n"));
    for (const record of records.slice(1)) assert.match(record, /^INFO  \[tagesschau\.cli\] .*\S$/);
    assert.ok(records.some((record) => /\] Usage: tagesschau /.test(record)), records.join("\n"));
  }
});

test("a parse error is logged in the format commander would have parsed (L6)", async () => {
  const isJsonl = (line: string): boolean => line.startsWith("{");
  const cases: [string[], boolean][] = [
    // Repeated: the last one counts, in commander and in the scan.
    [["--log-format", "text", "--log-format", "jsonl", "hompage"], true],
    [["--log-format", "jsonl", "--log-format", "text", "hompage"], false],
    // --log-format is --user-agent's value, so `jsonl` is an unknown command, logged in text.
    [["--user-agent", "--log-format", "jsonl", "channels"], false],
  ];
  for (const [argv, jsonl] of cases) {
    const cli = makeCli(() => jsonResponse({ channels: [] }));
    assert.equal(await run(argv, cli.deps), 1, argv.join(" "));
    assert.ok(cli.err.length > 0 && cli.err.every((line) => isJsonl(line) === jsonl), `${argv.join(" ")}:\n${cli.err.join("\n")}`);
  }
});

test("a malformed answer is an ERROR record of tagesschau.api, exit 1 (L9)", async () => {
  const answers: HttpResponse[] = [
    { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("not json") },
    jsonResponse({ searchResults: "none" }),
    jsonResponse({ searchResults: [], totalItemCount: -1 }),
  ];
  for (const answer of answers) {
    const cli = makeCli(() => answer);
    assert.equal(await run(["search", "Wahl"], cli.deps), 1);
    assert.match(untimed(cli.err.join("\n")), /^ERROR \[tagesschau\.api\] /);
  }
  // The CLI's own failure to print a valid answer is an output record.
  const deep = makeCli(() => ({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from('{"channels":[' + "[".repeat(200_000) + "]".repeat(200_000) + "]}") }));
  assert.equal(await run(["channels"], deep.deps), 1);
  assert.match(untimed(deep.err.join("\n")), /^ERROR \[tagesschau\.output\] The answer is nested too deeply/);
});

test("a single-value option given twice is a usage error, never 'the last one wins' (kit K5)", async () => {
  // commander keeps the last value silently: `--timeout 1000 --timeout 0` switched the timeout off.
  for (const [argv, name] of [
    [["--timeout", "1000", "--timeout", "0", "channels"], "--timeout"],
    [["--timeout=1000", "channels", "--timeout", "1000"], "--timeout"],
    [["--base-url", "https://www.tagesschau.de", "--base-url", "https://www.tagesschau.de", "channels"], "--base-url"],
    [["--log-format", "jsonl", "--log-format", "text", "channels"], "--log-format"],
    [["--user-agent", "a", "--user-agent", "b", "channels"], "--user-agent"],
    [["--max-retries", "1", "--max-retries", "2", "channels"], "--max-retries"],
    [["--max-redirects", "1", "--max-redirects", "2", "channels"], "--max-redirects"],
    [["--max-response-bytes", "1", "--max-response-bytes", "2", "channels"], "--max-response-bytes"],
    [["news", "--ressort", "inland", "--ressort", "ausland"], "--ressort"],
    [["news", "--date", "261004", "--date", "261003"], "--date"],
    [["search", "Wahl", "--page-size", "1", "--page-size", "2"], "--page-size"],
    [["search", "Wahl", "--result-page", "1", "--result-page", "2"], "--result-page"],
  ] as const) {
    const cli = makeCli(() => jsonResponse({ news: [], regional: [], channels: [], searchResults: [] }));
    assert.equal(await run([...argv], cli.deps), 1, argv.join(" "));
    assert.equal(cli.mt.calls.length, 0, `${argv.join(" ")} sent a request`);
    // Bug 3: the record says what is wrong, never that the (valid) second value is invalid.
    assert.equal(untimed(cli.err[0] ?? ""), `ERROR [tagesschau.cli] ${name} may be given only once.`, argv.join(" "));
    assert.ok(!cli.err.join("\n").includes("is invalid"), cli.err.join("\n"));
  }
  // The same in jsonl.
  const jsonl = makeCli(() => jsonResponse({ news: [] }));
  assert.equal(await run(["--log-format", "jsonl", "news", "--ressort", "inland", "--ressort", "inland"], jsonl.deps), 1);
  assert.equal((JSON.parse(jsonl.err[0] ?? "{}") as { msg?: string }).msg, "--ressort may be given only once.");
  // Flags may repeat, and so may the repeatable --region.
  const flags = makeCli(() => jsonResponse({ channels: [] }));
  assert.equal(await run(["--compact", "--compact", "channels"], flags.deps), 0);
  const regions = makeCli(() => jsonResponse({ news: [], regional: [] }));
  assert.equal(await run(["news", "--region", "5", "--region", "9"], regions.deps), 0);
  assert.equal(new URL(regions.mt.last().url).searchParams.get("regions"), "5,9");
});

test("an option with an array default is repeatable: each value adds to the list", async () => {
  const program = buildProgram(makeCli(() => jsonResponse({})).deps);
  const seen: string[][] = [];
  program
    .command("collect")
    .option("--tag <t>", "repeatable", (value: string, previous: string[]) => [...previous, value], [] as string[])
    .action((opts: { tag: string[] }) => void seen.push(opts.tag));
  forbidRepeatedOptions(program);
  await program.parseAsync(["collect", "--tag", "a", "--tag", "b"], { from: "user" });
  assert.deepEqual(seen, [["a", "b"]]);
});

test("terminal controls are escaped in chunks: the same text as one pass, across chunk edges (D7)", () => {
  const DEL = String.fromCharCode(0x7f);
  const C1 = String.fromCharCode(0x9b);
  const RLO = String.fromCharCode(0x202e);
  // Controls right before, at and after the 64 Ki edges, and a run of them.
  const text = ["a".repeat(65535), DEL, C1, "b".repeat(65534), RLO, DEL.repeat(70000), "ü😀", C1].join("");
  const { deps, out } = makeCli(() => jsonResponse([]));
  renderJson(deps, { compact: true }, { text });
  const expected = JSON.stringify({ text }).replace(/[\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
  assert.equal(out[0], expected);
  assert.deepEqual(JSON.parse(out[0]!), { text });
});

test("commander's echo of a rejected value shows invisible characters escaped, never raw (D10)", async () => {
  for (const [argv, ch] of [
    [["news", "--date", "2610​01"], "​"],
    [["news", "--bogus­"], "­"],
    [["frobnicate⁠"], "⁠"],
  ] as const) {
    const cli = makeCli(() => jsonResponse({ news: [] }));
    assert.equal(await run([...argv], cli.deps), 1, argv.join(" "));
    const err = cli.err.join("\n");
    assert.ok(err.includes(`\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`), err);
    assert.ok(!err.includes(ch), `raw in ${err}`);
    assert.equal(cli.mt.calls.length, 0);
  }
});
