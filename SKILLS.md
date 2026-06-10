# tagesschau-cli — Claude Code Skills

A set of [Claude Code](https://code.claude.com/docs/en/skills) **Agent Skills** for
reading German news from the terminal, all powered by the **[tagesschau](README.md)** CLI
over the open [Tagesschau API](https://tagesschau.api.bund.dev/) (`tagesschau.de`,
ARD-aktuell).

Each skill teaches Claude how to drive the `tagesschau` CLI to answer a specific,
real-world question — "what's the news in Germany?", "what's happening in Bayern?", "what
is Tagesschau saying about the Bundestag?", "give me the livestream URL" — and to report
the answer with links and evidence rather than guesswork. They encode the parts that are
easy to get wrong (the silent Ressort-vs-region precedence, the Berlin/Brandenburg
pairing, `null` share-URLs on video items, the `streams` object) so Claude doesn't have to
rediscover them each time.

## Skills

| Skill | What it does | Ask it… |
|---|---|---|
| **tagesschau-briefing** | Merges the curated homepage with topic feeds, leads with breaking news, groups by Ressort, dedups, and gives a ranked headline digest. | "what's the news in Germany?", "morning briefing", "top wirtschaft headlines" |
| **tagesschau-regional** | Resolves a Bundesland (or city) name to the API's region id, fetches the regional feed, and labels headlines by state. | "news from Bayern", "what's happening in NRW?", "Berlin and Hamburg headlines" |
| **tagesschau-topic-tracker** | Runs paged full-text search, reports the total hit count as a coverage signal, sorts newest-first, and splits articles from video. | "what is Tagesschau saying about X?", "how much coverage does Y get?", "latest on Z" |
| **tagesschau-watch-live** | Pulls the channels feed and hands back playable HLS stream URLs for the livestream and broadcast/accessibility variants. | "is the livestream on?", "stream URL for tagesschau24", "watch tagesschau live" |

## Requirements

- **[Claude Code](https://code.claude.com/docs/en/overview)** (or any harness that loads
  Agent Skills).
- **The `tagesschau` CLI** installed globally and on your PATH:
  ```bash
  npm i -g @maschinenlesbar.org/tagesschau-cli   # installs the `tagesschau` bin
  ```
  No API key is required — the Tagesschau API is free, open, and read-only.

## Installation

### Plugin marketplace (recommended)

This repo is a Claude Code **plugin marketplace**, so installation is two commands inside
Claude Code:

```
/plugin marketplace add maschinenlesbar-org/tagesschau-cli
/plugin install tagesschau@tagesschau-skills
```

The first command registers the marketplace; the second installs the `tagesschau` plugin,
which bundles all four skills. Update later with `/plugin marketplace update`.

### Manual (copy the skill folders)

Prefer not to use the marketplace? Copy the skills into your **personal** directory
(available across all your projects):

```bash
git clone https://github.com/maschinenlesbar-org/tagesschau-cli tmp-skills
mkdir -p ~/.claude/skills
cp -R tmp-skills/skills/* ~/.claude/skills/
rm -rf tmp-skills
```

…or into a single project's `.claude/skills/` by swapping `~/.claude/skills` for
`.claude/skills`. Each skill lives in its own directory with a `SKILL.md`, e.g.
`skills/tagesschau-briefing/SKILL.md`. Start a new Claude Code session and the skills are
picked up automatically.

## Usage

You don't normally invoke these by name — Claude auto-selects the right skill from your
request. Just ask in natural language:

> Give me a Tagesschau briefing of the top German news right now.

> What's the regional news for Bayern and Baden-Württemberg?

> How much is Tagesschau covering the Bundestag this week, newest first?

> Give me the HLS livestream URL for tagesschau24 so I can open it in VLC.

You can also invoke a skill explicitly with its slash command, e.g. `/tagesschau-briefing`.

## How it works

Every skill is a single `SKILL.md` — a short, model-facing playbook describing which
`tagesschau` subcommands to call, in what order, and how to interpret the JSON. The skills
encode the non-obvious parts of this API, for example:

- **`--ressort` silently wins over `--region`.** Passing both makes the API return
  national items (`regionId: 0`) and ignore the region entirely — so "topic within a
  state" must be filtered client-side (see **tagesschau-regional**);
- **Berlin (3) and Brandenburg (4) come as a pair** — requesting either returns items
  tagged with both region ids (the rbb broadcaster serves them jointly);
- **video items have `shareURL: null`** (and a `streams` object instead) — they appear in
  feeds and especially in search results, and must be flagged as "Video", not dropped as
  broken links (see **tagesschau-topic-tracker**);
- **search's `resultPage` echoes `0`** when you don't pass `--result-page`, but the data
  is the first page; `--result-page` itself is 1-based and pages correctly. Lead with
  `totalItemCount` as the coverage-volume signal;
- **`channels[].streams` is an object keyed by protocol** (`adaptivestreaming` → an HLS
  `.m3u8` URL), not a flat string, and the same channel title can appear more than once
  (see **tagesschau-watch-live**);
- **`ressort` is frequently `null`** on regional, video, and search items — group those
  into a fallback bucket rather than fabricating a topic.

## Contributing

This project does not accept external code contributions (see
[CONTRIBUTING.md](CONTRIBUTING.md)). When adding a skill internally, keep `SKILL.md`
focused, give it a `description` with concrete trigger phrases, and follow the
[official skill format](https://code.claude.com/docs/en/skills).

## License

[AGPL-3.0-or-later](LICENSE) © Sebastian Schürmann. See [LICENSING.md](LICENSING.md) for
the dual-licensing / commercial option.
