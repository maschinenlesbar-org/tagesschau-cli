# Examples

Real examples for the Claude Code skills of the `tagesschau` plugin, one per skill: a request,
the `tagesschau` commands the skill ran, and the answer Claude gave.

Every example ran against the live API on 15 September 2026 with `tagesschau` 0.0.6,
except tagesschau-topic-tracker, re-run on 26 September 2026 with 0.1.0.
The data changes, so your results will differ; the ids and keys shown work for trying the
requests yourself. Long lists are shortened.

To try them, install the CLI and the plugin — see [SKILLS.md](SKILLS.md).

Skills: [tagesschau-briefing](#tagesschau-briefing) · [tagesschau-regional](#tagesschau-regional) · [tagesschau-topic-tracker](#tagesschau-topic-tracker) · [tagesschau-watch-live](#tagesschau-watch-live)

## tagesschau-briefing

> Give me a Tagesschau briefing for this afternoon, and go a bit deeper on business news.

```bash
tagesschau --compact homepage
tagesschau --compact news --ressort wirtschaft
```

No item had `breakingNews: true`. The skill left the homepage's 16-item `regional` block out
of the national briefing. „Neue Aufgaben für die Apotheken" came back in both feeds and was
listed once (matched on `sophoraId`). The Wirtschaft feed holds 58 stories going back to 08.09.,
newest first, and 8 of them are from today.

```
Tagesschau — 15.09.2026, 17:42

EILMELDUNG
  (none right now)

Inland
  • Merz kündigt Entlastungen bei Spritpreisen an — Kanzler bei Unternehmertag
    tagesschau.de/inland/innenpolitik/merz-entlastungen-spritpreise-100.html
  • Kriminelle Gruppen werden digitaler und brutaler — BKA legt Bericht für 2025 vor
    Das BKA beobachtet einen tiefgreifenden Wandel der Organisierten Kriminalität.
  • Wahlkampf zwischen Euphorie und Entgeisterung — Wahl in Mecklenburg-Vorpommern
  • Mutmaßliche Mitglieder von Terrorgruppe festgenommen — Angriffe auf Eritrea-Festivals

Ausland
  • US-Behörde räumt Munitionsknappheit ein — Bericht zum Iran-Krieg
  • Verlängerung von Strafmaßnahmen vorerst blockiert — EU-Sanktionen gegen Russland
  • Russische Fregatte feuert Leuchtraketen auf Helikopter — Ostsee vor Dänemark

Wirtschaft (homepage + Ressort feed, today, newest first)
  • 17:30  Klagen gegen Preiserhöhungen bei Streaming-Diensten — Netflix, Apple TV und Wow
    tagesschau.de/wirtschaft/verbraucher/streaminganbieter-rechtsstreit-preiserhoehungen-100.html
  • 16:04  Was könnte die Politik gegen hohe Spritpreise machen? — Debatte über Entlastungen
  • 14:04  US-Rendite auf Niveau der Finanzkrise — Zinserwartungen verfestigt
  • 13:39  Neue Aufgaben für die Apotheken — Medizinische Dienstleister   (also on the homepage)
  • 12:34  Warum der Umstieg auf E-Lkw so schwierig ist — IAA Transportation in Hannover
  • 10:58  US-Zinsentscheid zwingt Anleger zur Vorsicht — DAX weiter auf Talfahrt
  …2 more from today; 58 in the feed back to 08.09.

Weitere
  • Wolken, Temperaturen, Wind und Aussichten — Wettervorhersage Deutschland
```

Next steps offered: regional headlines for a Bundesland (tagesschau-regional) or older Wirtschaft stories.

## tagesschau-regional

> What's the regional news from Sachsen and Thüringen today? Anything about the economy in Sachsen?

```bash
tagesschau --compact news --region 13 --region 16
```

The skill did not add `--ressort wirtschaft`, because the API then ignores the region. The 51
regional items have no `ressort`, `firstSentence` or tags, so the economy question was answered
by matching keywords (Industrie, Chip, Fabrik …) in title and URL locally. Both states shared
one page of 51 items (29 Sachsen, 22 Thüringen), and every link points to mdr.de.

```
Sachsen (Region 13) — 15.09.2026
  • 16:07  Streichung von Förderprogrammen: Muss Sachsen seine Kinos unterstützen?
  • 15:10  "Dein Ort. Deine Themen." in Belgern: Vorbeikommen, mitreden, hinter die Kulissen schauen
  • 14:56  Baustart für Carbon Lab Factory in Boxberg rückt näher
  • 14:47  Ermittlungen gegen Handwerker: Betrug mit Vorsatz oder "nur" unorganisiert?
  • 14:18  Dok Leipzig 2026 will ostdeutsche Perspektiven stärken
  • 11:31  AG Kino fordert mehr Geld vom Bund
  • 05:00  Neuer Hangar am Flugplatz Kamenz eröffnet
  …und 22 weitere (back to 11.09.)

Thüringen (Region 16) — 15.09.2026
  • 17:33  Pferde auf Münzen: Keltischer Schatz im Ilm-Kreis gefunden
  • 17:04  Weniger Kinder an Thüringens Schulen: Schülerzahl sinkt bis 2036 stark
  • 12:43  Kita-Moratorium in Erfurt gekippt: Thema erneut im Stadtrat
  • 12:41  Nach Explosion: Spürhunde sollen erneut bei Suche nach Hausbesitzer helfen
  …und 18 weitere (back to 11.09.)

Economy in Sachsen (filtered locally: the API can't combine region and Ressort)
  • 15.09.  Baustart für Carbon Lab Factory in Boxberg rückt näher
            mdr.de/nachrichten/sachsen/bautzen/bautzen-hoyerswerda-kamenz/boxberg-baustart-forschung-carbonfasern,carbon-forschung-labor-100.html
  • 14.09.  Richtfest für Chip-Fabrik von ESMC in Dresden gefeiert
            mdr.de/nachrichten/sachsen/dresden/dresden-radebeul/news-chipindustrie-richtfest-auto,halbleiterwerk-esmc-100.html
  • 11.09.  Aufbruch aus der Krise: So will Sachsen bis 2040 an die Spitze
            mdr.de/nachrichten/sachsen/news-industrie-reformen,wirtschaft-arbeitsplaetze-100.html
```

## tagesschau-topic-tracker

> Is Tagesschau covering the Landtagswahl in Mecklenburg-Vorpommern more and more?

```bash
tagesschau --compact search "Landtagswahl Mecklenburg-Vorpommern" --page-size 50 --result-page 0   # totalItemCount 276
tagesschau --compact search "Landtagswahl Mecklenburg-Vorpommern" --page-size 50 --result-page 1   # 50 hits
tagesschau --compact search "Landtagswahl Mecklenburg-Vorpommern" --page-size 50 --result-page 2   # 50 hits
tagesschau --compact search "Landtagswahl Mecklenburg-Vorpommern" --page-size 50 --result-page 3   # 50 hits
tagesschau --compact search "Landtagswahl Mecklenburg-Vorpommern" --page-size 50 --result-page 4   # 50 hits
tagesschau --compact search "Landtagswahl Mecklenburg-Vorpommern" --page-size 50 --result-page 5   # 26 hits
```

`--result-page` is 0-based, so `0` is the first page; `ceil(276 / 50) = 6` pages (0–5) gave all
276 hits, with no duplicates on `sophoraId`. The search matches loosely: 85 of the 276 hits name
MV, a town in MV or Schwesig in the title; the other 191 are loosely related — 26 name the Berlin
election held the same day, most of the rest are federal fallout and regional news tickers.

```
Tagesschau coverage of „Landtagswahl Mecklenburg-Vorpommern" — 276 Treffer

Timeline          hits   articles / videos   MV in title
  today 26.09.       1        1 / 0               0
  20.–25.09.       167       80 / 87             60
  13.–19.09.        44       18 / 26             22
  28.08.–12.09.     64       29 / 35              3
→ Coverage peaked on election day and the day after (20.09.: 63 hits, 21.09.: 87) and has
  dropped off since (22.09.: 11, 23.–26.09.: 7). Not "more and more" any longer — the race is decided.

Newest articles on MV
  • 25.09.  Schwesig fordert mehr Selbstkritik von Merz
            tagesschau.de/inland/innenpolitik/schwesig-kritik-merz-reformen-100.html
  • 22.09.  Wer mit wem in Schwerin und Berlin?
            tagesschau.de/inland/innenpolitik/regierungsbildung-berlin-mecklenburg-vorpommern-100.html
  • 21.09.  ++ Schwesig-SPD will mit Linken und Grünen sondieren ++
            tagesschau.de/newsticker/liveblog-nach-wahlen-berlin-mecklenburg-vorpommern-100.html

Videos on MV (70, Video, kein Artikel-Link)
  • 25.09.  Ministerpräsidentin Schwesig rückt nach Landtagswahl stärker in den Fokus der SPD
  • 22.09.  Parteiloser Landrat in Mecklenburg-Vorpommern fordert Abschaffung der Brandmauer
  • 22.09.  Stimmung in Mecklenburg-Vorpommern nach den Landtagswahlen
  • 21.09.  Die Stimmung in Mecklenburg-Vorpommern nach der Landtagswahl
  … 66 more

276 Treffer insgesamt · all 276 fetched (6 pages of 50).
```

Next steps offered: a narrower search term (e.g. "Regierungsbildung Schwerin"), or the same
check again in a week to follow the coalition talks.

## tagesschau-watch-live

> Is tagesschau24 live right now? I'd also like to watch last night's tagesschau with sign language in VLC.

```bash
tagesschau --compact channels
```

The feed listed 8 channels. „tagesschau" appears twice (15.09. 16:00, `ts-80954`, and 14.09.
20:00, `ts-81002`), so the skill kept both. The dated editions carry progressive MP4 links
(`h264s`/`h264m`/`h264xl`) next to `adaptivestreaming`. The livestream has only the HLS link and
no `date`.

```
Tagesschau — Live & Sendungen (15.09.2026)

LIVE
  tagesschau24 (Livestream, no date = always on)
    https://tagesschau-live.ard-mcdn.de/tagesschau/live/hls/de/master.m3u8

Barrierefrei
  tagesschau mit Gebärdensprache    14.09. 20:00   tsg-12260
    HLS  https://adaptive.tagesschau.de/i/video/2026/0914/TV-20260914-2024-4800.,webl.h264,webs.h264,webm.h264,webxl.h264,webxxl.h264,.mp4.csmil/master.m3u8
    MP4  https://tagesschau-progressive.ard-mcdn.de/video/2026/0914/TV-20260914-2024-4800.webxl.h264.mp4
  tagesschau in Einfacher Sprache   14.09. 19:00   tse-1432

Sendungen
  tagesschau in 100 Sekunden   15.09. 10:51   video-1649214
  tagesschau                   15.09. 16:00   ts-80954
  tagesschau                   14.09. 20:00   ts-81002
  tagesthemen                  14.09. 21:45   tt-12866
  tagesschau vor 20 Jahren     14.09. 22:45   tsvorzwanzig-9620

Play with: vlc <url>  or  mpv <url>  (any HLS player, Safari too)
```

Next steps offered: the HLS or MP4 link for any other edition.
