import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertValid,
  baseUrlProblem,
  baseUrlWhitespaceProblem,
  headerValueProblem,
  MAX_SEARCH_INT,
  pageSizeProblem,
  regionProblem,
  resultPageProblem,
  ressortProblem,
  searchTextProblem,
  type Problem,
} from "@maschinenlesbar.org/tagesschau-client/internal/validate";
import * as lib from "../src/index.js";
import { assertHeaderValue, validateBaseUrl } from "@maschinenlesbar.org/tagesschau-client/internal/engine";
import { TagesschauError, TagesschauValidationError } from "@maschinenlesbar.org/tagesschau-client/internal/errors";
import { TagesschauClient } from "@maschinenlesbar.org/tagesschau-client/internal/client";
import { run } from "../src/cli/run.js";
import type { CliDeps } from "../src/cli/io.js";
import { parity, jsonResponse, untimed } from "./helpers.js";

const nonBlank: Problem<string> = (v) => (v.trim() === "" ? "Expected a non-empty value." : undefined);

test("assertValid returns a valid value unchanged", () => {
  assert.equal(assertValid("searchText", "Wahl", nonBlank), "Wahl");
});

test("assertValid throws TagesschauValidationError 'Invalid <name>: <reason>'", () => {
  assert.throws(
    () => assertValid("searchText", "  ", nonBlank),
    (err: unknown) =>
      err instanceof TagesschauValidationError &&
      err instanceof TagesschauError &&
      err.name === "TagesschauValidationError" &&
      err.message === "Invalid searchText: Expected a non-empty value.",
  );
});

test("the validation layer is exported from the package root", () => {
  assert.equal(lib.assertValid, assertValid);
  assert.equal(lib.TagesschauValidationError, TagesschauValidationError);
});

test("run() maps a TagesschauValidationError raised in an action to exit 1 and an ERROR record", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    io: { out: (s) => out.push(s), err: (s) => err.push(s) },
    createClient: () => {
      throw new TagesschauValidationError("Invalid thing: Expected a non-empty value.");
    },
  };
  assert.equal(await run(["channels"], deps), 1);
  assert.deepEqual(err.map(untimed), ["ERROR [tagesschau.cli] Invalid thing: Expected a non-empty value."]);
  assert.deepEqual(out, []);
});

test("parity() runs one input through the CLI and the library on one recording transport", async () => {
  const { cli, lib: l } = await parity(
    ["--compact", "channels"],
    (transport) => new TagesschauClient({ transport }).channels(),
    () => jsonResponse({ channels: [{ title: "tagesschau24" }] }),
  );
  assert.equal(cli.code, 0);
  assert.equal(cli.requests.length, 1);
  assert.equal(l.ok, true);
  assert.equal(l.requests.length, 1);
  assert.equal(cli.requests[0]!.url, l.requests[0]!.url);
  assert.deepEqual(JSON.parse(cli.out), l.ok ? l.value : undefined);
});

test("searchTextProblem: a blank or missing search text is refused, any other text passes", () => {
  for (const v of ["", " ", "\t\n", "　", undefined, null, 42]) {
    assert.equal(searchTextProblem(v), "search text must not be empty.", JSON.stringify(v));
  }
  for (const v of ["Wahl", " Wahl ", "Köln", "0"]) {
    assert.equal(searchTextProblem(v), undefined, JSON.stringify(v));
  }
  assert.equal(lib.searchTextProblem, searchTextProblem);
});

test("regionProblem / ressortProblem: only the documented ids and Ressorts pass", () => {
  for (const v of ["1", "9", "16"]) assert.equal(regionProblem(v), undefined, v);
  for (const v of [" 9", "9\n"]) assert.equal(regionProblem(v), undefined, v);
  for (const v of ["17", "0", "09", "9,10", "1e1", 9, undefined, "toString"]) {
    assert.match(String(regionProblem(v)), /^Invalid region ".*"\. Expected one of: 1, 2, .*, 16\.$/, String(v));
  }
  for (const v of ["inland", "wissen"]) assert.equal(ressortProblem(v), undefined, v);
  for (const v of [" wirtschaft", "inland\t"]) assert.equal(ressortProblem(v), undefined, v);
  for (const v of ["", "  ", "\u200b", "in\u00adland"]) assert.match(String(ressortProblem(v)), /^Invalid ressort: /, v);
  for (const v of ["Wirtschaft", "bogus", undefined, "constructor"]) {
    assert.match(String(ressortProblem(v)), /^Invalid ressort ".*"\. Expected one of: inland, .*, wissen\.$/, String(v));
  }
  assert.equal(lib.regionProblem, regionProblem);
  assert.equal(lib.ressortProblem, ressortProblem);
});

test("pageSizeProblem / resultPageProblem: undefined or a safe integer in range passes", () => {
  assert.equal(lib.MAX_SEARCH_INT, 2147483647);
  for (const v of [undefined, 1, 25, MAX_SEARCH_INT]) assert.equal(pageSizeProblem(v), undefined, String(v));
  for (const v of [undefined, 0, 3, MAX_SEARCH_INT]) assert.equal(resultPageProblem(v), undefined, String(v));
  for (const v of [0, -1, 1.5, NaN, Infinity, MAX_SEARCH_INT + 1, "5"]) {
    assert.equal(
      pageSizeProblem(v),
      `expected an integer from 1 to 2147483647, got ${typeof v === "string" ? JSON.stringify(v) : String(v)}.`,
      String(v),
    );
  }
  for (const v of [-1, 0.5, NaN, -Infinity, MAX_SEARCH_INT + 1, null]) {
    assert.equal(
      resultPageProblem(v),
      `expected an integer from 0 to 2147483647, got ${String(v)}.`,
      String(v),
    );
  }
  assert.equal(lib.pageSizeProblem, pageSizeProblem);
  assert.equal(lib.resultPageProblem, resultPageProblem);
});

test("baseUrlWhitespaceProblem: surrounding or inner whitespace and controls are refused", () => {
  for (const v of ["https://h/ ", " https://h", "https://h/p\t", "https://h/p\n"]) {
    assert.equal(baseUrlWhitespaceProblem(v), "A base URL cannot have surrounding whitespace.", JSON.stringify(v));
  }
  for (const v of ["https://h/a b", "https://h/a\tb", "https://h/a\u0000b", "https://h/a\u007fb", "https://h/a b"]) {
    assert.equal(
      baseUrlWhitespaceProblem(v),
      "A base URL cannot contain whitespace or control characters.",
      JSON.stringify(v),
    );
  }
  for (const v of ["https://www.tagesschau.de", "http://localhost:8080/prefix/"]) {
    assert.equal(baseUrlWhitespaceProblem(v), undefined, v);
  }
  assert.equal(lib.baseUrlWhitespaceProblem, baseUrlWhitespaceProblem);
});

test("baseUrlProblem: every base-URL rule in order; validateBaseUrl strips trailing slashes", () => {
  const cases: [unknown, string | undefined][] = [
    ["https://www.tagesschau.de", undefined],
    ["http://u:pw@mirror.test/ts/", undefined],
    ["", "Expected an absolute http(s) URL."],
    ["   ", "Expected an absolute http(s) URL."],
    [undefined, "Expected an absolute http(s) URL."],
    [" https://h", "A base URL cannot have surrounding whitespace."],
    [" ftp://h", "A base URL cannot have surrounding whitespace."],
    ["https://h/a b", "A base URL cannot contain whitespace or control characters."],
    ["not-a-url", "Expected an absolute http(s) URL."],
    ["ftp://h", 'Unsupported scheme "ftp:". Expected an http(s) URL.'],
    ["https://h/?q", "A base URL cannot have a query (?) or fragment (#)."],
    ["https://h/#", "A base URL cannot have a query (?) or fragment (#)."],
  ];
  for (const [v, reason] of cases) assert.equal(baseUrlProblem(v), reason, JSON.stringify(v));
  assert.equal(validateBaseUrl("https://mirror.test/ts//"), "https://mirror.test/ts");
  assert.throws(
    () => validateBaseUrl("ftp://u:pw@h"),
    (err: unknown) =>
      err instanceof TagesschauValidationError &&
      err.message === 'Invalid baseUrl: Unsupported scheme "ftp:". Expected an http(s) URL.',
  );
  assert.equal(lib.baseUrlProblem, baseUrlProblem);
  assert.equal(lib.validateBaseUrl, validateBaseUrl);
});

test("headerValueProblem: blank, control characters (tab allowed) and above U+00FF are refused", () => {
  for (const v of ["", "   ", "\t", undefined, 42]) {
    assert.equal(headerValueProblem(v), "Expected a non-empty value.", JSON.stringify(v));
  }
  for (const v of ["a\r\nb", "a\u0000b", "a\u001bb", "a\u007fb"]) {
    assert.equal(headerValueProblem(v), "Value contains control characters.", JSON.stringify(v));
  }
  for (const v of ["€", "aĀ", "😀"]) {
    assert.equal(headerValueProblem(v), "Value contains characters outside Latin-1 (above U+00FF).", JSON.stringify(v));
  }
  for (const v of ["my-app/1.0", " padded ", "a\tb", "éÿ", "a\u0085b"]) {
    assert.equal(headerValueProblem(v), undefined, JSON.stringify(v));
  }
  assert.equal(assertHeaderValue("userAgent", "x/1"), "x/1");
  assert.throws(
    () => assertHeaderValue("userAgent", ""),
    (err: unknown) =>
      err instanceof TagesschauValidationError && err.message === "Invalid userAgent: Expected a non-empty value.",
  );
  assert.equal(lib.headerValueProblem, headerValueProblem);
  assert.equal(lib.assertHeaderValue, assertHeaderValue);
});

test("a refusal quotes the value visibly: invisible and format characters escaped, never raw (D10)", async () => {
  const c = new TagesschauClient({ transport: async () => jsonResponse({ news: [] }) });
  const cases: Array<[string, () => Promise<unknown>, string]> = [
    ["a zero-width space in a region", () => c.news({ regions: ["9​"] as never }), "\\u200b"],
    ["a bidi override in a ressort", () => c.news({ ressort: "inland‮" as never }), "\\u202e"],
    ["a soft hyphen in an unknown key", () => c.news({ ["regi­ons"]: ["9"] } as never), "\\u00ad"],
    ["a zero-width joiner in a date", () => c.news({ date: "2610‍01" }), "\\u200d"],
    ["a word joiner in a page size", () => c.search({ searchText: "Wahl", pageSize: "1⁠" as never }), "\\u2060"],
  ];
  for (const [label, call, escape] of cases) {
    await assert.rejects(call, (err: unknown) => {
      assert.ok(err instanceof TagesschauValidationError, label);
      assert.ok(err.message.includes(escape), `${label}: ${err.message}`);
      assert.ok(!/[­​‍‮⁠]/.test(err.message), `${label}: raw in ${err.message}`);
      return true;
    });
  }
  // The CLI's refusal shows it too (the log escapes bidi controls, not zero-width ones).
  const err: string[] = [];
  const deps: CliDeps = { io: { out: () => {}, err: (s) => err.push(s) }, createClient: () => c };
  assert.equal(await run(["news", "--region", "9​"], deps), 1);
  assert.ok(err.some((line) => line.includes("\\u200b")) && !err.some((line) => line.includes("​")), err.join("\n"));
});

test("a search text of invisible characters is blank; a control, format or half character is refused, never sent (bugs 1, 2)", async () => {
  // Bug 1: U+200B, U+200D, U+2060, U+00AD, U+180E alone went out (live: totalItemCount 0, exit 0).
  for (const v of ["​", "‍", "⁠", "­", "᠎", "́̈", "¨", " ​ "]) {
    assert.equal(searchTextProblem(v), "search text must not be empty.", JSON.stringify(v));
  }
  // Bug 1: BEL, ESC and U+202E went out as typed; Koeln + U+200B too. Bug 2: a lone surrogate
  // went out as U+FFFD (URLSearchParams), a changed value.
  const refused: Array<[string, string]> = [
    ["Köln\u0007", "control character (U+0007)"],
    ["\u001b[31mKöln", "control character (U+001B)"],
    ["‮Köln", "invisible character (U+202E)"],
    ["Koeln​", "invisible character (U+200B)"],
    ["\ud800", "half of a character"],
    ["a\udfffb", "half of a character"],
  ];
  for (const [v, reason] of refused) {
    const problem = searchTextProblem(v) ?? "";
    assert.ok(problem.startsWith("search text \"") && problem.includes(reason), `${JSON.stringify(v)}: ${problem}`);
    assert.ok(!/[\u0007\u001b‮​\ud800-\udfff]/.test(problem), `raw in ${problem}`);
    const { cli, lib: library } = await parity(["--compact", "search", v], (transport) => new TagesschauClient({ transport }).search({ searchText: v }));
    assert.equal(cli.code, 1, JSON.stringify(v));
    assert.equal(cli.requests.length, 0, JSON.stringify(v));
    assert.equal(library.requests.length, 0, JSON.stringify(v));
    assert.ok(!library.ok && library.error instanceof TagesschauValidationError, JSON.stringify(v));
  }
  // ZWJ inside a word (emoji, scripts), TAB and inner whitespace stay; NFKC and the trim stay.
  for (const v of ["a‍b", "Köln\tBonn", " ﬁsch "]) assert.equal(searchTextProblem(v), undefined, JSON.stringify(v));
});
