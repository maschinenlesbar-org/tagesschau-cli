# Beispiele

Echte Beispiele für die Claude-Code-Skills des Plugins `tagesschau`, eines pro Skill: eine
Anfrage, die `tagesschau`-Befehle, die der Skill ausgeführt hat, und Claudes Antwort.

tagesschau-briefing, tagesschau-regional und tagesschau-topic-tracker liefen am 6. Oktober 2026
mit `tagesschau` 0.3.0 gegen die Live-API; tagesschau-watch-live lief am 15. September 2026 mit
0.0.6.
Die Daten ändern sich, Ihre Ergebnisse werden also abweichen; mit den gezeigten IDs und
Schlüsseln können Sie die Anfragen selbst ausprobieren. Lange Listen sind gekürzt.

Zum Ausprobieren installieren Sie die CLI und das Plugin – siehe [SKILLS.md](SKILLS.md) (englisch).

Skills: [tagesschau-briefing](#tagesschau-briefing) · [tagesschau-regional](#tagesschau-regional) · [tagesschau-topic-tracker](#tagesschau-topic-tracker) · [tagesschau-watch-live](#tagesschau-watch-live)

## tagesschau-briefing

> Tagesschau-Überblick zu später Stunde, mit etwas mehr Tiefe bei der Wirtschaft.

```bash
tagesschau --compact homepage
tagesschau --compact news --ressort wirtschaft
```

Keine Meldung hatte `breakingNews: true`. Den `regional`-Block der Startseite (diesmal 16
Einträge, einer pro Bundesland) ließ der Skill im nationalen Überblick weg. Drei
Wirtschaftsbeiträge kamen in beiden Feeds vor und stehen nur einmal in der Liste (abgeglichen
über `sophoraId`). Es war 02:27 Uhr, der Wirtschaft-Feed hatte also noch nichts vom 6. Oktober:
Seine 50 Beiträge reichen zurück bis zum 29.09., 9 davon vom 5. Oktober; er wurde vor dem
Kürzen neueste zuerst nach `date` sortiert.

```
Tagesschau – 06.10.2026, 02:27

EILMELDUNG
  (gerade keine)

Wissen
  • "Ich bin natürlich überwältigt" – Nobelpreisträger Hegemann
    In den tagesthemen berichtet Hegemann vom Nutzen der Optogenetik - und fordert mehr Mut von der Politik.
    tagesschau.de/wissen/forschung/tagesthemen-interview-hegemann-100.html

Inland
  • Die Bedrohung ist da - aber was heißt das? – Bilanz der Nachrichtendienste
    tagesschau.de/inland/innenpolitik/nachrichtendienste-praesidenten-bedrohung-100.html
  • Pharmafirmen sollen für Wasserreinigung zahlen – Pläne des Bundesumweltministers

Ausland
  • Moskau dementiert tödlichen Pestfall in Sibirien – Gerüchte um Laborunfall

Wirtschaft (Startseite + Ressort-Feed, 05.10., neueste zuerst)
  • 18:42  Preise für Benzin und Diesel steigen wieder leicht – Hohe Energiepreise   (auch auf der Startseite)
    tagesschau.de/wirtschaft/verbraucher/spritpreise-tankrabatt-120.html
  • 18:28  DAX kommt nicht vom Fleck – Euro rutscht ab
  • 15:44  Flugpreise aus Deutschland seit 2010 etwa verdoppelt – Kosten für Tickets   (auch auf der Startseite)
  • 14:11  Euro fällt unter 1,12 Dollar – Talfahrt geht weiter
  • 13:23  Wie die E-Auto-Prämie wirkt – Staatlicher Kaufanreiz
  • 12:27  100.000 Antragsteller profitieren von E-Auto-Prämie – Erwartungen übertroffen   (auch auf der Startseite)
  • 12:01  E-Autos boomen bei deutschen Käufern – Hohe Spritpreise und E-Auto-Prämie
  • 11:15  Sanierung dauert deutlich länger - und wird teurer – Bahnstrecke Berlin-Hannover
  …1 weiterer vom 05.10.; 50 im Feed, zurück bis 29.09.

Weitere
  • Wolken, Temperaturen, Wind und Aussichten – Wettervorhersage Deutschland
```

Als Nächstes angeboten: regionale Schlagzeilen für ein Bundesland (tagesschau-regional) oder die
nächste, ältere Seite des Wirtschaft-Feeds (`--date 260928` aus seinem `nextPage`).

## tagesschau-regional

> Was gibt es Neues aus Sachsen und Thüringen? Und etwas zur Wirtschaft in Sachsen?

```bash
tagesschau --compact news --region 13 --region 16
```

Der Skill hat `--ressort wirtschaft` nicht ergänzt: Die CLI lehnt es neben `--region` ab, weil
die API die Region dann ignorieren würde. Die 61 Regionalmeldungen haben weder `ressort` noch
Tags, nur 2 haben ein `firstSentence`. Die Wirtschaftsfrage wurde deshalb lokal beantwortet,
über Stichwörter (Industrie, Insolvenz, investieren …) in Titel und URL; ein Treffer auf
„Handwerkskunst" bei einem Herbstfest wurde von Hand aussortiert. Beide Länder teilten sich eine
Seite mit 61 Einträgen (31 Sachsen, 30 Thüringen, zurück bis 02.10.), und alle Links führen zu
mdr.de. Vom 6. Oktober gab es um 02:27 Uhr noch nichts.

```
Sachsen (Region 13) – neueste vom 05.10.2026
  • 19:59  Museum der Westlausitz: Förderverein kritisiert Ausstiegspläne des Landkreises Bautzen
  • 18:53  Kommunen in Sachsen investieren Millionen in Energiewende
  • 17:20  Polizei gibt Ermittlungsstand nach Schlägerei auf Dorffest in Beicha bekannt
  • 15:54  Nach Protest-Aktion: Dresden richtet echten Zebrastreifen vor Musikschule ein
  • 15:14  Sachsen: Theater demonstrieren in Dresden gegen Kürzungen
  • 14:13  "Gaubln" ist Sachsens Wort des Jahres
  • 12:54  Leipziger Schauspiel überzeugt mit XXXL-Inszenierung
  …und 24 weitere (zurück bis 02.10.)

Thüringen (Region 16) – neueste vom 05.10.2026
  • 20:28  Bangen um Kulturprojekte - Bundesentscheidung trifft auch Weimarer Vereine
  • 19:59  Microverse Center Jena eröffnet: 55,6 Millionen Euro für neue Mikrobiomforschung
  • 18:03  Kein Ende nach Urteil im "Raserprozess"
  • 15:23  Neue Chipfabrik in Erfurt soll Unabhängigkeit von Asien stärken
  • 12:16  Die Veranstaltungstipps für Thüringen
  • 09:42  Zwei Tote: Kleinflugzeug aus Thüringen stürzt bei Heilbronn ab
  …und 24 weitere (zurück bis 02.10.)

Wirtschaft in Sachsen (lokal gefiltert – die API kann Region und Ressort nicht kombinieren)
  • 05.10.  Kommunen in Sachsen investieren Millionen in Energiewende
            mdr.de/nachrichten/sachsen/klima-waermepumpe-energiewende,kommunen-waermeplan-100.html
  • 02.10.  Solar-Anbieter EKD in Leipzig ist insolvent
            mdr.de/nachrichten/sachsen/leipzig/leipzig-leipzig-land/news-pleite-solar,insolvenz-ekd-100.html
```

Als Nächstes angeboten: die nächste, ältere Seite (`--date 261001` aus `nextPage`) oder eine
Anfrage pro Land für den vollständigen Feed jedes Landes.

## tagesschau-topic-tracker

> Wie viel berichtet die Tagesschau gerade über Koeln?

```bash
tagesschau --compact search "Köln" --page-size 20 --result-page 0    # totalItemCount 394
tagesschau --compact search "Koeln" --page-size 1                    # totalItemCount 212, dazu ein Hinweis auf stderr
```

Der Skill suchte nach der richtigen Schreibweise der Stadt, `Köln`, wie es seine Regel zur
Schreibweise verlangt. Um zu zeigen, was die ASCII-Schreibweise liefert, lief `Koeln` nur für die
Zahl: 212 statt 394 Treffer, und die CLI gab auf stderr `Note: the search matches spellings
literally ("Koeln" finds far fewer hits than "Köln", …)` aus. Die Suche ist unscharf: 6 der
ersten 20 Treffer nennen Köln in Titel oder URL; die übrigen stammen aus Regional-Tickern und
Seiten der Sender (Flughafen Stuttgart, Koblenz, Saarland, zwei Videos zur Bundespolitik). Keine
Duplikate über `sophoraId`.

```
Tagesschau-Berichterstattung zu „Köln" – 394 Treffer
  (wie eingegeben, „Koeln": 212 – die API vergleicht die Schreibweise wörtlich)

Neueste zu Köln (erste Seite, 20 Treffer: 18 vom 05.10., 2 vom 04.10.)
  • 05.10.  Kölner Oper muss Bühnenstück neu inszenieren
            www1.wdr.de/nrw/koeln/oper-koeln-technik-probleme-100.html
  • 05.10.  Internationale Auszeichnung: Said El Mala für den "Golden Boy" nominiert
            www1.wdr.de/sport/fc-koeln/golden-boy-el-mala-nominierung100.html
  • 05.10.  Prozess um geraubte Drogen in Köln
            www1.wdr.de/nrw/koeln/koeln-drogen-konflikt-raub-marihuana-100.html
  • 04.10.  Vier neue Rekorde beim Köln Marathon
            www1.wdr.de/nrw/koeln/koeln-marathon-2026-strecke-startzeit-datum-sperrungen-1-100.html

Videos (7 auf dieser Seite, Video, kein Artikel-Link)
  • 05.10.  Prozessauftakt Drogenkrieg-Eskalation in Köln
  • 05.10.  Prozessauftakt im Kölner Drogenkonflikt | WDR Aktuell
  • 05.10.  Technische Probleme bei der Oper gehen weiter
  … 4 weitere, nicht zu Köln

394 Treffer insgesamt · Seite 1 von 20 (20/Seite). Mehr? Sag „nächste Seite".
```

Als Nächstes angeboten: die nächste Seite oder ein engerer Begriff wie „Kölner Oper" oder
„Drogenkonflikt Köln".

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
