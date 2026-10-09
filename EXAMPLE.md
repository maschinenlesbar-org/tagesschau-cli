# Examples

Real examples for the Claude Code skills of the `tagesschau` plugin, one per skill: a request,
the `tagesschau` commands the skill ran, and the answer Claude gave.

tagesschau-briefing, tagesschau-regional and tagesschau-topic-tracker ran against the live API
on 6 October 2026 with `tagesschau` 0.3.0; tagesschau-watch-live ran on 15 September 2026 with
0.0.6.
The data changes, so your results will differ; the ids and keys shown work for trying the
requests yourself. Long lists are shortened.

To try them, install the CLI and the plugin — see [SKILLS.md](SKILLS.md).

Skills: [tagesschau-briefing](#tagesschau-briefing) · [tagesschau-regional](#tagesschau-regional) · [tagesschau-topic-tracker](#tagesschau-topic-tracker) · [tagesschau-watch-live](#tagesschau-watch-live)

## tagesschau-briefing

> Give me a late-night Tagesschau briefing, and go a bit deeper on business news.

```bash
tagesschau --compact homepage
tagesschau --compact news --ressort wirtschaft
```

No item had `breakingNews: true`. The skill left the homepage's `regional` block (16 items
this time, one per Bundesland) out of the national briefing. Three Wirtschaft stories came
back in both feeds and are listed once (matched on `sophoraId`). It was 02:27, so the
Wirtschaft feed had nothing from 6 October yet: its 50 stories go back to 29.09., 9 of them
from 5 October; it was sorted newest-first by `date` before cutting.

```
Tagesschau — 06.10.2026, 02:27

EILMELDUNG
  (none right now)

Wissen
  • "Ich bin natürlich überwältigt" — Nobelpreisträger Hegemann
    In den tagesthemen berichtet Hegemann vom Nutzen der Optogenetik - und fordert mehr Mut von der Politik.
    tagesschau.de/wissen/forschung/tagesthemen-interview-hegemann-100.html

Inland
  • Die Bedrohung ist da - aber was heißt das? — Bilanz der Nachrichtendienste
    tagesschau.de/inland/innenpolitik/nachrichtendienste-praesidenten-bedrohung-100.html
  • Pharmafirmen sollen für Wasserreinigung zahlen — Pläne des Bundesumweltministers

Ausland
  • Moskau dementiert tödlichen Pestfall in Sibirien — Gerüchte um Laborunfall

Wirtschaft (homepage + Ressort feed, 05.10., newest first)
  • 18:42  Preise für Benzin und Diesel steigen wieder leicht — Hohe Energiepreise   (also on the homepage)
    tagesschau.de/wirtschaft/verbraucher/spritpreise-tankrabatt-120.html
  • 18:28  DAX kommt nicht vom Fleck — Euro rutscht ab
  • 15:44  Flugpreise aus Deutschland seit 2010 etwa verdoppelt — Kosten für Tickets   (also on the homepage)
  • 14:11  Euro fällt unter 1,12 Dollar — Talfahrt geht weiter
  • 13:23  Wie die E-Auto-Prämie wirkt — Staatlicher Kaufanreiz
  • 12:27  100.000 Antragsteller profitieren von E-Auto-Prämie — Erwartungen übertroffen   (also on the homepage)
  • 12:01  E-Autos boomen bei deutschen Käufern — Hohe Spritpreise und E-Auto-Prämie
  • 11:15  Sanierung dauert deutlich länger - und wird teurer — Bahnstrecke Berlin-Hannover
  …1 more from 05.10.; 50 in the feed back to 29.09.

Weitere
  • Wolken, Temperaturen, Wind und Aussichten — Wettervorhersage Deutschland
```

Next steps offered: regional headlines for a Bundesland (tagesschau-regional) or the next,
older page of the Wirtschaft feed (`--date 260928`, from its `nextPage`).

## tagesschau-regional

> What's the latest regional news from Sachsen and Thüringen? Anything about the economy in Sachsen?

```bash
tagesschau --compact news --region 13 --region 16
```

The skill did not add `--ressort wirtschaft`: the CLI refuses it next to `--region`, because
the API would ignore the region. The 61 regional items have no `ressort` and no tags, and only
2 have a `firstSentence`, so the economy question was answered by matching keywords (Industrie,
Insolvenz, investieren …) in title and URL locally; a festival hit on "Handwerkskunst" was
dropped by hand. Both states shared one page of 61 items (31 Sachsen, 30 Thüringen, back to
02.10.), and every link points to mdr.de. Nothing from 6 October yet at 02:27.

```
Sachsen (Region 13) — newest from 05.10.2026
  • 19:59  Museum der Westlausitz: Förderverein kritisiert Ausstiegspläne des Landkreises Bautzen
  • 18:53  Kommunen in Sachsen investieren Millionen in Energiewende
  • 17:20  Polizei gibt Ermittlungsstand nach Schlägerei auf Dorffest in Beicha bekannt
  • 15:54  Nach Protest-Aktion: Dresden richtet echten Zebrastreifen vor Musikschule ein
  • 15:14  Sachsen: Theater demonstrieren in Dresden gegen Kürzungen
  • 14:13  "Gaubln" ist Sachsens Wort des Jahres
  • 12:54  Leipziger Schauspiel überzeugt mit XXXL-Inszenierung
  …und 24 weitere (back to 02.10.)

Thüringen (Region 16) — newest from 05.10.2026
  • 20:28  Bangen um Kulturprojekte - Bundesentscheidung trifft auch Weimarer Vereine
  • 19:59  Microverse Center Jena eröffnet: 55,6 Millionen Euro für neue Mikrobiomforschung
  • 18:03  Kein Ende nach Urteil im "Raserprozess"
  • 15:23  Neue Chipfabrik in Erfurt soll Unabhängigkeit von Asien stärken
  • 12:16  Die Veranstaltungstipps für Thüringen
  • 09:42  Zwei Tote: Kleinflugzeug aus Thüringen stürzt bei Heilbronn ab
  …und 24 weitere (back to 02.10.)

Economy in Sachsen (filtered locally: the API can't combine region and Ressort)
  • 05.10.  Kommunen in Sachsen investieren Millionen in Energiewende
            mdr.de/nachrichten/sachsen/klima-waermepumpe-energiewende,kommunen-waermeplan-100.html
  • 02.10.  Solar-Anbieter EKD in Leipzig ist insolvent
            mdr.de/nachrichten/sachsen/leipzig/leipzig-leipzig-land/news-pleite-solar,insolvenz-ekd-100.html
```

Next steps offered: the next, older page (`--date 261001` from `nextPage`), or one request per
state for each state's full feed.

## tagesschau-topic-tracker

> How much is Tagesschau reporting on Koeln at the moment?

```bash
tagesschau --compact search "Köln" --page-size 20 --result-page 0    # totalItemCount 394
tagesschau --compact search "Koeln" --page-size 1                    # totalItemCount 212, plus an INFO record on stderr
```

The skill searched the city's real spelling, `Köln`, as its spelling rule says. To show the
user what the ASCII spelling gives, it also ran `Koeln` for the count alone: 212 hits instead of
394, and the CLI logged its spelling note on stderr, an `INFO` record of `tagesschau.api`:
`the search matches spellings literally ("Koeln" finds far fewer hits than "Köln", …)`. The search matches loosely: 6 of the first 20 hits name Köln in
title or URL; the others come from regional tickers and broadcaster pages (Stuttgart airport,
Koblenz, Saarland, two Bundespolitik videos). No duplicates on `sophoraId`.

```
Tagesschau coverage of „Köln" — 394 Treffer
  (as typed, „Koeln": 212 — the API matches the spelling literally)

Newest on Köln (first page, 20 hits: 18 from 05.10., 2 from 04.10.)
  • 05.10.  Kölner Oper muss Bühnenstück neu inszenieren
            www1.wdr.de/nrw/koeln/oper-koeln-technik-probleme-100.html
  • 05.10.  Internationale Auszeichnung: Said El Mala für den "Golden Boy" nominiert
            www1.wdr.de/sport/fc-koeln/golden-boy-el-mala-nominierung100.html
  • 05.10.  Prozess um geraubte Drogen in Köln
            www1.wdr.de/nrw/koeln/koeln-drogen-konflikt-raub-marihuana-100.html
  • 04.10.  Vier neue Rekorde beim Köln Marathon
            www1.wdr.de/nrw/koeln/koeln-marathon-2026-strecke-startzeit-datum-sperrungen-1-100.html

Videos (7 on this page, Video, kein Artikel-Link)
  • 05.10.  Prozessauftakt Drogenkrieg-Eskalation in Köln
  • 05.10.  Prozessauftakt im Kölner Drogenkonflikt | WDR Aktuell
  • 05.10.  Technische Probleme bei der Oper gehen weiter
  … 4 more, not about Köln

394 Treffer insgesamt · Seite 1 von 20 (20/Seite). Mehr? Sag „nächste Seite".
```

Next steps offered: the next page, or a narrower term such as "Kölner Oper" or
"Drogenkonflikt Köln".

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
