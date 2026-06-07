import type { Command } from "commander";
import type { CliDeps } from "../io.js";
import { action, assertEnum, parsePagingArg, renderJson } from "../shared.js";
import { RegionValues, RessortValues } from "../../client/enums.js";
import { TagesschauError } from "../../client/errors.js";
import type { NewsParams } from "../../client/types.js";

/** commander accumulator for repeatable --region, validated against 1..16. */
function collectRegion(value: string, previous: string[] = []): string[] {
  return previous.concat([assertEnum(value, RegionValues, "region")]);
}

export function registerNewsCommands(program: Command, deps: CliDeps): void {
  program
    .command("homepage")
    .description("The curated homepage feed (top + regional news)")
    .action(
      action(deps, async ({ client, global }) => {
        renderJson(deps, global, await client.homepage());
      }),
    );

  program
    .command("news")
    .description("The news feed, optionally filtered by region and/or Ressort")
    .option("--ressort <ressort>", `topic: ${RessortValues.join(" | ")}`)
    .option("--region <id>", "Bundesland id 1..16 (repeatable)", collectRegion)
    .action(
      action(deps, async ({ client, global, opts }) => {
        const params: NewsParams = {};
        if (opts["ressort"] !== undefined) {
          params.ressort = assertEnum(String(opts["ressort"]), RessortValues, "ressort");
        }
        if (opts["region"] !== undefined) params.regions = opts["region"] as string[];
        renderJson(deps, global, await client.news(params));
      }),
    );

  program
    .command("channels")
    .description("The live/broadcast channels")
    .action(
      action(deps, async ({ client, global }) => {
        renderJson(deps, global, await client.channels());
      }),
    );

  program
    .command("search <text>")
    .description("Full-text search across articles")
    .option("--page-size <n>", "pageSize parameter (>= 1)", parsePagingArg)
    .option("--result-page <n>", "resultPage parameter (>= 1)", parsePagingArg)
    .action(
      action(deps, async ({ client, global, opts }, [text]) => {
        if (text === undefined || text.trim() === "") {
          throw new TagesschauError("search text must not be empty.");
        }
        renderJson(
          deps,
          global,
          await client.search({
            searchText: text,
            pageSize: opts["pageSize"] as number | undefined,
            resultPage: opts["resultPage"] as number | undefined,
          }),
        );
      }),
    );
}
