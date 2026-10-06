import { InvalidArgumentError, type Command } from "commander";
import type { CliDeps } from "../io.js";
import { action, once, parsePagingArg, parseResultPage, renderJson } from "../shared.js";
import { RessortValues, type Region, type Ressort } from "../../client/enums.js";
import { TagesschauError, TagesschauValidationError } from "../../client/errors.js";
import { newsDateProblem } from "../../client/client.js";
import { MAX_SEARCH_INT, regionProblem, ressortProblem } from "../../client/validate.js";
import type { NewsParams } from "../../client/types.js";

/**
 * commander accumulator for repeatable --region, checked by the library's
 * regionProblem (1..16) at parse time, with the library's error and message.
 */
function collectRegion(value: string, previous: Region[] = []): Region[] {
  const problem = regionProblem(value);
  if (problem !== undefined) throw new TagesschauValidationError(problem);
  return previous.concat([value as Region]);
}

/** commander value-parser for --date: YYMMDD, a real calendar day. */
function parseNewsDate(value: string): string {
  const problem = newsDateProblem(value);
  if (problem !== undefined) throw new InvalidArgumentError(problem);
  return value;
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
    .option(
      "--ressort <ressort>",
      `topic: ${RessortValues.join(" | ")} (once; not with --region)`,
      once((value: string) => value),
    )
    .option("--region <id>", "Bundesland id 1..16 (repeatable)", collectRegion)
    .option(
      "--date <yymmdd>",
      "page cursor: the date=YYMMDD value of a previous response's nextPage (the next, older page)",
      once(parseNewsDate),
    )
    .action(
      action(deps, async ({ client, global, opts }) => {
        const params: NewsParams = {};
        if (opts["ressort"] !== undefined) {
          // The library's rule, checked before the combination rule below.
          const problem = ressortProblem(opts["ressort"]);
          if (problem !== undefined) throw new TagesschauValidationError(problem);
          params.ressort = opts["ressort"] as Ressort;
        }
        if (opts["region"] !== undefined) params.regions = opts["region"] as Region[];
        if (opts["date"] !== undefined) params.date = opts["date"] as string;
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
    .option("--page-size <n>", `pageSize parameter (1..${MAX_SEARCH_INT})`, once(parsePagingArg))
    .option(
      "--result-page <n>",
      `resultPage parameter (0-based; 0 = first page; at most ${MAX_SEARCH_INT})`,
      once(parseResultPage),
    )
    .action(
      action(deps, async ({ client, global, opts }, [text]) => {
        // A blank text is refused by client.search() itself (searchTextProblem).
        renderJson(
          deps,
          global,
          await client.search({
            searchText: text as string,
            pageSize: opts["pageSize"] as number | undefined,
            resultPage: opts["resultPage"] as number | undefined,
          }),
        );
      }),
    );
}
