---
name: tagesschau-regional
description: >
  Get regional German news for one or more Bundesländer by name using the
  tagesschau-cli. Trigger when the user asks "news from Bayern", "what's
  happening in NRW?", "regional news for Berlin and Hamburg", "Sachsen
  headlines", or names any German federal state. Resolves state names to the
  API's numeric region ids, queries the (region-filtered) news feed, and labels
  each headline by state — handling the id mapping and the Ressort/region trap
  the bare CLI leaves to you.
version: 1.0.0
userInvocable: true
---

# Tagesschau Regional News

Answer "what's the news in <Bundesland>?" — resolving the state **name** the user gave
to the API's numeric `--region` id, fetching the regional feed for one or several states,
and presenting headlines labelled by state.

## Tooling

This skill drives the `tagesschau` command. **Before anything else, validate it is available** — run `command -v tagesschau` (or `tagesschau --version`). If it is not on your PATH, STOP and inform the user that the `tagesschau` CLI (`@maschinenlesbar.org/tagesschau-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

Data comes from the `tagesschau` CLI — read-only, no API key, plain GETs. Pass `--compact`. An empty `news` array is a valid "nothing regional right now" answer.

## Step 1 — Resolve state name → region id

The CLI takes a numeric `--region <id>` (1–16), **not** a name. Map the user's wording
using this table (ids are alphabetical by Bundesland, as the API documents them):

| id | Bundesland | also said |
|---|---|---|
| 1 | Baden-Württemberg | BW, Ländle, Stuttgart |
| 2 | Bayern | BY, Bavaria, München |
| 3 | Berlin | BE |
| 4 | Brandenburg | BB, Potsdam |
| 5 | Bremen | HB |
| 6 | Hamburg | HH |
| 7 | Hessen | HE, Frankfurt |
| 8 | Mecklenburg-Vorpommern | MV, Meck-Pomm |
| 9 | Niedersachsen | NI, Lower Saxony, Hannover |
| 10 | Nordrhein-Westfalen | NRW, NW, Köln, Düsseldorf, Ruhrgebiet |
| 11 | Rheinland-Pfalz | RP, Mainz |
| 12 | Saarland | SL, Saarbrücken |
| 13 | Sachsen | SN, Saxony, Dresden, Leipzig |
| 14 | Sachsen-Anhalt | ST, Magdeburg |
| 15 | Schleswig-Holstein | SH, Kiel |
| 16 | Thüringen | TH, Thuringia, Erfurt |

If the user names a **city**, map it to its state (München → 2, Köln → 10). `--region` is
repeatable — pass it once per state; the client joins them into `?regions=5,9`.

## Step 2 — Fetch the regional feed

```bash
# Bayern (2)
tagesschau --compact news --region 2

# Berlin (3) and Hamburg (6) together
tagesschau --compact news --region 3 --region 6
```

The result is `{ news, regional, nextPage?, type }`. **For a `--region` query the items
land in `news`, each tagged with its `regionId`; the top-level `regional` array is empty**
(it's only populated on the unfiltered `homepage`). Expect ~50–55 items per state.

> **Trap — Berlin & Brandenburg come as a pair.** Requesting `--region 3` (Berlin) or
> `--region 4` (Brandenburg) returns items tagged with **both** `regionId: 3` *and* `4`
> (the rbb broadcaster serves the region jointly). That's upstream behaviour, not a bug —
> say "Berlin/Brandenburg" rather than implying you mixed states by mistake.

> **Critical trap — do NOT combine `--ressort` with `--region`.** When both are passed,
> the live API **silently honours the Ressort and ignores the region**: every returned
> item comes back with `regionId: 0` (national), not your state. So "Bayern + Wirtschaft"
> is *not* achievable server-side. If the user wants a topic within a state, fetch the
> region feed alone and **filter client-side** by inspecting each item's `ressort` /
> `tags` / `shareURL`, and tell the user you filtered locally.

## Step 3 — The fields that matter

Per item (same shape as the briefing skill): `title`, `topline`, `firstSentence`,
`date` (ISO 8601 +offset), `regionId` (your state, when filtered), `shareURL` (can be
`null` for video), `ressort` (often `null` on regional items), `sophoraId` (its prefix
encodes the regional broadcaster — `swr` = BW, `br` = BY, `rb` = Bremen, `ndr`/`aktuell…`
= North, `wdr` = NRW, `mdr` = SN/ST/TH, etc.).

## Step 4 — Present, labelled by state

Group by state when several were requested; within a state, sort newest-first by `date`:

```
Niedersachsen (Region 9) — 12.06.2026

  • A39: Bauarbeiten zwischen … — Verkehr
    tagesschau.de/regional/niedersachsen/…
  • Hannover beschließt … — Kommunalpolitik
  …und 43 weitere.

Bremen (Region 5) — 12.06.2026
  • Bremer Hafen meldet … 
```

Rules:
- Lead each state block with its name + id; map `regionId` back to the name from the
  Step 1 table.
- Cap at ~10–15 newest per state, then a "…und N weitere" count.
- Attach `shareURL`; for `null` URLs note "(Video)".
- If the user asked for a topic-within-state, say explicitly that you filtered locally
  because the API can't do region+ressort together.
- Empty `news` for a state → "Aktuell keine regionalen Meldungen für <state>."
