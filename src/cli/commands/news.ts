import type { Command } from "commander";
import type { CliDeps } from "../io.js";
import { action, assertEnum, parseIntArg, parsePagingArg, renderJson } from "../shared.js";
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
    .description("The news feed, optionally filtered by region or by Ressort (not both)")
    .option("--ressort <ressort>", `topic: ${RessortValues.join(" | ")} (not with --region)`)
    .option("--region <id>", "Bundesland id 1..16 (repeatable)", collectRegion)
    .action(
      action(deps, async ({ client, global, opts }) => {
        const params: NewsParams = {};
        if (opts["ressort"] !== undefined) {
          params.ressort = assertEnum(String(opts["ressort"]), RessortValues, "ressort");
        }
        if (opts["region"] !== undefined) params.regions = opts["region"] as string[];
        if (params.ressort !== undefined && params.regions !== undefined) {
          throw new TagesschauError(
            "--ressort and --region cannot be combined: the API applies the Ressort and silently ignores " +
              "the region, so every item would come back national (regionId 0). Fetch the region feed and " +
              "filter it locally instead (see Usage.md, use case 6).",
          );
        }
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
    .option("--result-page <n>", "resultPage parameter (0-based; 0 = first page)", parseIntArg)
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
