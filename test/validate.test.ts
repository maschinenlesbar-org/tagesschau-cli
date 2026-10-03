import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertValid,
  MAX_SEARCH_INT,
  pageSizeProblem,
  regionProblem,
  resultPageProblem,
  ressortProblem,
  searchTextProblem,
  type Problem,
} from "../src/client/validate.js";
import * as lib from "../src/index.js";
import { TagesschauError, TagesschauValidationError } from "../src/client/errors.js";
import { TagesschauClient } from "../src/client/client.js";
import { run } from "../src/cli/run.js";
import type { CliDeps } from "../src/cli/io.js";
import { parity, jsonResponse } from "./helpers.js";

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

test("run() maps a TagesschauValidationError raised in an action to exit 1, 'Error: <message>'", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    io: { out: (s) => out.push(s), err: (s) => err.push(s) },
    createClient: () => {
      throw new TagesschauValidationError("Invalid thing: Expected a non-empty value.");
    },
  };
  assert.equal(await run(["channels"], deps), 1);
  assert.deepEqual(err, ["Error: Invalid thing: Expected a non-empty value."]);
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
  for (const v of ["17", "0", "", " 9", "09", "9,10", "1e1", 9, undefined, "toString"]) {
    assert.match(String(regionProblem(v)), /^Invalid region ".*"\. Expected one of: 1, 2, .*, 16\.$/, String(v));
  }
  for (const v of ["inland", "wissen"]) assert.equal(ressortProblem(v), undefined, v);
  for (const v of ["Wirtschaft", "", "  ", " wirtschaft", "bogus", undefined, "constructor"]) {
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
      `expected an integer from 1 to 2147483647, got ${String(v)}.`,
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
