---
name: tagesschau-watch-live
description: >
  List the Tagesschau live and broadcast channels and their stream URLs using
  the tagesschau-cli. Trigger when the user asks "is the Tagesschau livestream
  on?", "stream URL for tagesschau24", "what channels does Tagesschau have?",
  "give me the m3u8 / HLS link", "watch tagesschau live", "tagesschau in
  Einfacher Sprache / Gebärdensprache stream", or wants the linear/streaming
  programme feeds. Pulls the channels feed and hands back playable stream links.
version: 1.0.0
userInvocable: true
---

# Tagesschau Watch Live

Hand the user the **playable stream URLs** for ARD-aktuell's live and broadcast channels —
the livestream, the short formats, and the accessibility variants — instead of the raw
channels JSON.

## Tooling

This skill drives the `tagesschau` command. **Before anything else, validate it is available** — run `command -v tagesschau` (or `tagesschau --version`). If it is not on your PATH, STOP and inform the user that the `tagesschau` CLI (`@maschinenlesbar.org/tagesschau-cli`) is not installed — installing it is their responsibility; never install it yourself, and do not fall back to `npx` or a local `node dist/...` build.

Data comes from the `tagesschau` CLI — read-only, no API key. Pass `--compact`. The command takes no arguments.

## Step 1 — Fetch the channels

```bash
tagesschau --compact channels
```

Returns `{ channels: [...], type }`. There are ~8 channels. Each entry:

| Field | Meaning |
|---|---|
| `title` | Channel name, e.g. `Im Livestream: tagesschau24`, `tagesschau`, `tagesthemen`, `tagesschau in 100 Sekunden`, `tagesschau in Einfacher Sprache`, `tagesschau mit Gebärdensprache`, `tagesschau vor 20 Jahren` |
| `streams` | **Object** of `{ <protocol>: <url> }` — usually `{ "adaptivestreaming": "https://…/master.m3u8" }`. This is the playable link |
| `type` | Typically `video` |
| `copyright` | Rights holder (`tagesschau`) |
| `date` | Air/publish time — **often `null`** for the perpetual livestream; set for dated clips |
| `sophoraId` | Stable internal id |
| `tracking` | Analytics metadata — ignore |

> **Quirk: `streams` is an object keyed by protocol, not a string.** Read
> `streams.adaptivestreaming` (an HLS `.m3u8` URL); there may be other keys. Don't assume
> a single flat URL. The same human title can appear **more than once** (e.g. two
> `tagesschau` entries — different editions/lengths); disambiguate by `date` /
> `sophoraId`, don't silently drop one.

## Step 2 — Present playable links

List each channel with its title and HLS URL; call out the perpetual livestream and the
accessibility variants:

```
Tagesschau — Live & Sendungen

🔴 LIVE
  tagesschau24 (Livestream)
    https://tagesschau-live.ard-mcdn.de/tagesschau/live/hls/de/master.m3u8

Sendungen
  tagesschau in 100 Sekunden     https://…/master.m3u8
  tagesschau (Hauptausgabe)      https://…/master.m3u8
  tagesthemen                    https://…/master.m3u8

Barrierefrei
  tagesschau in Einfacher Sprache   https://…/master.m3u8
  tagesschau mit Gebärdensprache    https://…/master.m3u8
```

Rules:
- The `.m3u8` URLs are **HLS** — playable in VLC (`vlc <url>`), `mpv <url>`, Safari, or
  any HLS player; mention that if the user wants to actually watch.
- Surface every channel; group the live stream, the dated editions, and the accessibility
  variants (Einfache Sprache, Gebärdensprache) so the user can pick.
- If a channel has `date`, show it (dated clip vs. the always-on livestream which has
  `date: null`).
- Read the URL from `streams.adaptivestreaming` (or whatever protocol key exists); if a
  channel has no `streams`, say it's currently unavailable rather than emitting a blank.
- Don't fabricate availability — the feed lists what ARD currently offers; if a requested
  format (e.g. a specific show) isn't in the list, say so.
