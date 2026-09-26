# Beispiele

Echte Beispiele für die Claude-Code-Skills des Plugins `tagesschau`, eines pro Skill: eine
Anfrage, die `tagesschau`-Befehle, die der Skill ausgeführt hat, und Claudes Antwort.

Jedes Beispiel lief am 15. September 2026 mit `tagesschau` 0.0.6 gegen die Live-API,
außer tagesschau-topic-tracker, das am 26. September 2026 mit 0.1.0 neu lief.
Die Daten ändern sich, Ihre Ergebnisse werden also abweichen; mit den gezeigten IDs und
Schlüsseln können Sie die Anfragen selbst ausprobieren. Lange Listen sind gekürzt.

Zum Ausprobieren installieren Sie die CLI und das Plugin – siehe [SKILLS.md](SKILLS.md) (englisch).

Skills: [tagesschau-briefing](#tagesschau-briefing) · [tagesschau-regional](#tagesschau-regional) · [tagesschau-topic-tracker](#tagesschau-topic-tracker) · [tagesschau-watch-live](#tagesschau-watch-live)

## tagesschau-briefing

> Tagesschau-Überblick für heute Nachmittag, mit etwas mehr Tiefe bei der Wirtschaft.

```bash
tagesschau --compact homepage
tagesschau --compact news --ressort wirtschaft
```

Keine Meldung hatte `breakingNews: true`. Den `regional`-Block der Startseite (16 Einträge) ließ
der Skill im nationalen Überblick weg. „Neue Aufgaben für die Apotheken" kam in beiden Feeds
vor und steht nur einmal in der Liste (abgeglichen über `sophoraId`). Der Wirtschaft-Feed enthält
58 Beiträge zurück bis zum 08.09., neueste zuerst, davon 8 von heute.

```
Tagesschau – 15.09.2026, 17:42

EILMELDUNG
  (derzeit keine)

Inland
  • Merz kündigt Entlastungen bei Spritpreisen an – Kanzler bei Unternehmertag
    tagesschau.de/inland/innenpolitik/merz-entlastungen-spritpreise-100.html
  • Kriminelle Gruppen werden digitaler und brutaler – BKA legt Bericht für 2025 vor
    Das BKA beobachtet einen tiefgreifenden Wandel der Organisierten Kriminalität.
  • Wahlkampf zwischen Euphorie und Entgeisterung – Wahl in Mecklenburg-Vorpommern
  • Mutmaßliche Mitglieder von Terrorgruppe festgenommen – Angriffe auf Eritrea-Festivals

Ausland
  • US-Behörde räumt Munitionsknappheit ein – Bericht zum Iran-Krieg
  • Verlängerung von Strafmaßnahmen vorerst blockiert – EU-Sanktionen gegen Russland
  • Russische Fregatte feuert Leuchtraketen auf Helikopter – Ostsee vor Dänemark

Wirtschaft (Startseite + Ressort-Feed, heute, neueste zuerst)
  • 17:30  Klagen gegen Preiserhöhungen bei Streaming-Diensten – Netflix, Apple TV und Wow
    tagesschau.de/wirtschaft/verbraucher/streaminganbieter-rechtsstreit-preiserhoehungen-100.html
  • 16:04  Was könnte die Politik gegen hohe Spritpreise machen? – Debatte über Entlastungen
  • 14:04  US-Rendite auf Niveau der Finanzkrise – Zinserwartungen verfestigt
  • 13:39  Neue Aufgaben für die Apotheken – Medizinische Dienstleister   (auch auf der Startseite)
  • 12:34  Warum der Umstieg auf E-Lkw so schwierig ist – IAA Transportation in Hannover
  • 10:58  US-Zinsentscheid zwingt Anleger zur Vorsicht – DAX weiter auf Talfahrt
  …2 weitere von heute; 58 im Feed, zurück bis 08.09.

Weitere
  • Wolken, Temperaturen, Wind und Aussichten – Wettervorhersage Deutschland
```

Als Nächstes angeboten: regionale Schlagzeilen für ein Bundesland (tagesschau-regional) oder ältere Wirtschaftsbeiträge.

## tagesschau-regional

> Was gibt es heute an Regionalnachrichten aus Sachsen und Thüringen? Und etwas zur Wirtschaft in Sachsen?

```bash
tagesschau --compact news --region 13 --region 16
```

Der Skill hat `--ressort wirtschaft` nicht ergänzt, weil die API dann die Region ignoriert. Die
51 Regionalmeldungen haben weder `ressort` noch `firstSentence` noch Tags. Die Wirtschaftsfrage
wurde deshalb lokal beantwortet, über Stichwörter (Industrie, Chip, Fabrik …) in Titel und URL.
Beide Länder teilten sich eine Seite mit 51 Einträgen (29 Sachsen, 22 Thüringen), und alle Links
führen zu mdr.de.

```
Sachsen (Region 13) – 15.09.2026
  • 16:07  Streichung von Förderprogrammen: Muss Sachsen seine Kinos unterstützen?
  • 15:10  "Dein Ort. Deine Themen." in Belgern: Vorbeikommen, mitreden, hinter die Kulissen schauen
  • 14:56  Baustart für Carbon Lab Factory in Boxberg rückt näher
  • 14:47  Ermittlungen gegen Handwerker: Betrug mit Vorsatz oder "nur" unorganisiert?
  • 14:18  Dok Leipzig 2026 will ostdeutsche Perspektiven stärken
  • 11:31  AG Kino fordert mehr Geld vom Bund
  • 05:00  Neuer Hangar am Flugplatz Kamenz eröffnet
  …und 22 weitere (zurück bis 11.09.)

Thüringen (Region 16) – 15.09.2026
  • 17:33  Pferde auf Münzen: Keltischer Schatz im Ilm-Kreis gefunden
  • 17:04  Weniger Kinder an Thüringens Schulen: Schülerzahl sinkt bis 2036 stark
  • 12:43  Kita-Moratorium in Erfurt gekippt: Thema erneut im Stadtrat
  • 12:41  Nach Explosion: Spürhunde sollen erneut bei Suche nach Hausbesitzer helfen
  …und 18 weitere (zurück bis 11.09.)

Wirtschaft in Sachsen (lokal gefiltert – die API kann Region und Ressort nicht kombinieren)
  • 15.09.  Baustart für Carbon Lab Factory in Boxberg rückt näher
            mdr.de/nachrichten/sachsen/bautzen/bautzen-hoyerswerda-kamenz/boxberg-baustart-forschung-carbonfasern,carbon-forschung-labor-100.html
  • 14.09.  Richtfest für Chip-Fabrik von ESMC in Dresden gefeiert
            mdr.de/nachrichten/sachsen/dresden/dresden-radebeul/news-chipindustrie-richtfest-auto,halbleiterwerk-esmc-100.html
  • 11.09.  Aufbruch aus der Krise: So will Sachsen bis 2040 an die Spitze
            mdr.de/nachrichten/sachsen/news-industrie-reformen,wirtschaft-arbeitsplaetze-100.html
```

## tagesschau-topic-tracker

> Berichtet die Tagesschau zunehmend über die Landtagswahl in Mecklenburg-Vorpommern?

```bash
tagesschau --compact search "Landtagswahl Mecklenburg-Vorpommern" --page-size 50 --result-page 0   # totalItemCount 276
tagesschau --compact search "Landtagswahl Mecklenburg-Vorpommern" --page-size 50 --result-page 1   # 50 Treffer
tagesschau --compact search "Landtagswahl Mecklenburg-Vorpommern" --page-size 50 --result-page 2   # 50 Treffer
tagesschau --compact search "Landtagswahl Mecklenburg-Vorpommern" --page-size 50 --result-page 3   # 50 Treffer
tagesschau --compact search "Landtagswahl Mecklenburg-Vorpommern" --page-size 50 --result-page 4   # 50 Treffer
tagesschau --compact search "Landtagswahl Mecklenburg-Vorpommern" --page-size 50 --result-page 5   # 26 Treffer
```

`--result-page` zählt ab 0, `0` ist also die erste Seite; `ceil(276 / 50) = 6` Seiten (0–5)
ergaben alle 276 Treffer, ohne Dubletten bei `sophoraId`. Die Suche ist unscharf: 85 der 276
Treffer nennen MV, einen Ort in MV oder Schwesig im Titel; die übrigen 191 hängen nur lose
damit zusammen – 26 nennen die Berliner Wahl am selben Tag, die meisten anderen sind
bundespolitische Folgen und regionale Newsticker.

```
Tagesschau-Berichterstattung zu „Landtagswahl Mecklenburg-Vorpommern" – 276 Treffer

Zeitraum          Treffer   Artikel / Videos   MV im Titel
  heute 26.09.         1         1 / 0              0
  20.–25.09.         167        80 / 87            60
  13.–19.09.          44        18 / 26            22
  28.08.–12.09.       64        29 / 35             3
→ Die Berichterstattung erreichte am Wahltag und am Tag danach ihren Höhepunkt (20.09.: 63
  Treffer, 21.09.: 87) und ist seitdem stark zurückgegangen (22.09.: 11, 23.–26.09.: 7).
  „Zunehmend" stimmt nicht mehr – die Wahl ist entschieden.

Neueste Artikel zu MV
  • 25.09.  Schwesig fordert mehr Selbstkritik von Merz
            tagesschau.de/inland/innenpolitik/schwesig-kritik-merz-reformen-100.html
  • 22.09.  Wer mit wem in Schwerin und Berlin?
            tagesschau.de/inland/innenpolitik/regierungsbildung-berlin-mecklenburg-vorpommern-100.html
  • 21.09.  ++ Schwesig-SPD will mit Linken und Grünen sondieren ++
            tagesschau.de/newsticker/liveblog-nach-wahlen-berlin-mecklenburg-vorpommern-100.html

Videos zu MV (70, Video, kein Artikel-Link)
  • 25.09.  Ministerpräsidentin Schwesig rückt nach Landtagswahl stärker in den Fokus der SPD
  • 22.09.  Parteiloser Landrat in Mecklenburg-Vorpommern fordert Abschaffung der Brandmauer
  • 22.09.  Stimmung in Mecklenburg-Vorpommern nach den Landtagswahlen
  • 21.09.  Die Stimmung in Mecklenburg-Vorpommern nach der Landtagswahl
  … 66 weitere

276 Treffer insgesamt · alle 276 abgerufen (6 Seiten zu je 50).
```

Als Nächstes angeboten: ein engerer Suchbegriff (etwa „Regierungsbildung Schwerin") oder
dieselbe Auswertung in einer Woche erneut, um die Koalitionsgespräche zu verfolgen.

## tagesschau-watch-live

> Läuft tagesschau24 gerade live? Außerdem die tagesschau mit Gebärdensprache von gestern Abend in VLC ansehen.

```bash
tagesschau --compact channels
```

Der Feed listet 8 Kanäle. „tagesschau" kommt zweimal vor (15.09. 16:00, `ts-80954`, und
14.09. 20:00, `ts-81002`); der Skill hat beide behalten. Die datierten Ausgaben haben neben
`adaptivestreaming` auch progressive MP4-Links (`h264s`/`h264m`/`h264xl`). Der Livestream hat
nur den HLS-Link und kein `date`.

```
Tagesschau – Live & Sendungen (15.09.2026)

LIVE
  tagesschau24 (Livestream, ohne Datum = läuft durchgehend)
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

Abspielen mit: vlc <url>  oder  mpv <url>  (jeder HLS-Player, auch Safari)
```

Als Nächstes angeboten: der HLS- oder MP4-Link für jede andere Ausgabe.
