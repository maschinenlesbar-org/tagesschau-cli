// CLI <-> library parity: the same input through run() and through the library
// call must give the same outcome — both reject before any request, or both send
// the identical request.

import { test } from "node:test";
import assert from "node:assert/strict";
import { TagesschauClient } from "../src/client/client.js";
import { TagesschauValidationError } from "../src/client/errors.js";
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
    assert.equal(cli.err, "Error: search text must not be empty.", label);
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
