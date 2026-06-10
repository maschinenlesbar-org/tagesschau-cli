---
name: tagesschau-briefing
description: >
  Produce a ranked German-news briefing from ARD-aktuell's Tagesschau feed using
  the tagesschau-cli. Trigger when the user asks "what's the news in Germany?",
  "give me a Tagesschau briefing", "top headlines right now", "what's happening
  in [wirtschaft/sport/ausland]?", "morning news digest", or wants a quick
  read-out of current German headlines. Merges the curated homepage with topic
  (Ressort) feeds, leads with breaking news, groups by topic, and drops
  duplicates — not the raw nested JSON the CLI returns.
version: 1.0.0
userInvocable: true
---

# Tagesschau News Briefing

Turn the Tagesschau feeds into a tight, ranked **"what's happening in Germany now"**
briefing: breaking news first, then the curated top stories grouped by topic, with a
one-line teaser each — instead of the deeply nested per-item JSON the CLI emits.

## Tooling

This skill drives the `tagesschau` command. **Before anything else, validate it is available** — run `command -v tagesschau` (or `tagesschau --version`). If it is not on your PATH, STOP and inform the user that the `tagesschau` CLI (`@maschinenlesbar.org/tagesschau-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

All data comes from the `tagesschau` CLI — read-only, needs **no API key**, and each command is a plain GET. Pass `--compact` so each result is one line, easy to pipe into `jq`. Bump `--timeout 60000` if a call times out. Empty arrays / `totalItemCount: 0` are valid "nothing to report" answers, not errors.

## Step 1 — Pull the feeds

For a general briefing, start with the curated front page:

```bash
tagesschau --compact homepage
```

It returns `{ news, regional, type, newStoriesCountLink }`. `news` is the editorially
ranked top stories (~9 items); `regional` is a per-state block (one item per Bundesland,
each tagged `regionId` 1–16) — **ignore `regional` for a national briefing** unless the
user asked for regional news (then use the **tagesschau-regional** skill).

If the user scoped to a topic ("just business", "sport only"), pull that Ressort feed
instead of / in addition to the homepage:

```bash
tagesschau --compact news --ressort wirtschaft
```

Valid `--ressort` values: `inland`, `ausland`, `wirtschaft`, `sport`, `video`,
`investigativ`, `wissen`. A Ressort feed is much larger (50–60 items) and ordered
newest-first, not editorially ranked — so for "top news" prefer `homepage`; use Ressort
feeds to go deep on one topic.

## Step 2 — The fields that matter

Each item in `news` (and `regional`) is a raw, deeply nested object. Read only these
top-level fields for a briefing:

| Field | Meaning |
|---|---|
| `title` | The headline |
| `topline` | Short kicker/context line above the headline (e.g. `Spritpreise`) |
| `firstSentence` | One-sentence summary — the teaser |
| `ressort` | Topic: `inland`, `ausland`, `wirtschaft`, `sport`, … Can be **`null`** (esp. video items and regional items) |
| `date` | ISO 8601 with offset, e.g. `2026-06-10T19:03:25.655+02:00` — sort/recency |
| `breakingNews` | Boolean — `true` means **Eilmeldung**; lead with these |
| `type` | `story`, `video`, `webview`, … — most are `story`; `video` items have no readable body |
| `regionId` | `0` for national items; `1`–`16` on regional ones |
| `shareURL` | Public `tagesschau.de` article URL — cite this. **Can be `null`** (video items) |
| `tags[].tag` | Topic tags — useful for grouping/dedup |
| `sophoraId` | Stable internal id; prefix often encodes the regional broadcaster |

Ignore the heavy nested fields (`content[]`, `teaserImage.imageVariants`, `tracking`,
`updateCheckUrl`) unless the user asks for full article text — `content[]` holds the body
as `{type, value}` blocks with HTML in `value`.

## Step 3 — Rank, group, dedup

1. **Breaking news first.** Any item with `breakingNews === true` leads the briefing,
   flagged as *Eilmeldung*.
2. **Then the homepage order** for top stories — it is already the editorial ranking;
   don't re-sort it by date. (Ressort/regional feeds *are* newest-first by `date`.)
3. **Group by `ressort`** for readability (Inland / Ausland / Wirtschaft / Sport / …).
   Items with `ressort === null` go in a "Weitere"/"Video" bucket — infer a topic from
   `shareURL` path or `tags` if useful, but don't fabricate one.
4. **Dedup across feeds.** If you pulled both `homepage` and a Ressort feed, the same
   story appears in both — match on `sophoraId` (or `shareURL`) and keep one.

## Step 4 — Brief the user

Lead with a date/time stamp, then breaking news, then grouped headlines with a teaser:

```
Tagesschau — 10.06.2026, 23:35

🔴 EILMELDUNG
  (none right now)

Inland
  • Proteste in Praxen und Kliniken — Warkens Sparpläne
    Auch die Gesundheitsministerkonferenz protestiert gegen die geplanten Kürzungen.
    tagesschau.de/inland/innenpolitik/plaene-reform-krankenkassen-protest-100.html
  • So viele Rentner wie noch nie — Demografischer Wandel

Ausland
  • Trump droht mit „harten" Angriffen auf Iran — Trotz Waffenruhe

Wirtschaft
  • Tankrabatt wird nicht verlängert — Spritpreise
```

Rules:
- **Cap it.** A briefing is ~8–12 headlines. For a topic-deep request, list the top
  ~10–15 newest of that Ressort, with a count of how many more exist.
- Show `topline` + `title` together (the topline is the framing); add `firstSentence`
  only for the lead items, not every one.
- Always attach `shareURL` for stories the user might open; for `null`-URL video items,
  say "(Video, kein Artikel-Link)".
- Format `date` to local German style (`DD.MM.YYYY, HH:MM`) from the ISO string.
- Don't dump `content[]` HTML unless asked for the full article; if asked, strip the
  HTML tags from each `content[].value` block of `type === "text"`.
- If a feed comes back empty, say so plainly rather than implying an outage.
