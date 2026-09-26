# Glossar

Ein Nachschlagewerk für die Fachbegriffe und projektspezifischen Begriffe, die in
`tagesschau-cli` verwendet werden. Die Fachsprache der Tagesschau ist deutsch; dieses
Glossar nennt die Begriffe so, wie sie in API und CLI vorkommen, zusammen mit dem
gebräuchlichen deutschen Wort, wo es eines gibt.

> **Kurzüberblick.** Dieses Tool kapselt die offene **Tagesschau-API** ohne
> Authentifizierung (`tagesschau.de`), den strukturierten deutschen Nachrichten-Feed von
> ARD-aktuell. Alles ist ein lesendes `GET`; es gibt keinen Schlüssel, keinen Upload und
> keine Schreibzugriffe.

---

## Die Tagesschau-API

**Tagesschau.** Die wichtigste Fernsehnachrichtensendung Deutschlands, produziert von
**ARD-aktuell** und ausgestrahlt von der öffentlich-rechtlichen ARD. Ihre Website
`tagesschau.de` veröffentlicht dieselben redaktionellen Inhalte als strukturierte Daten.

**ARD – Arbeitsgemeinschaft der öffentlich-rechtlichen Rundfunkanstalten.** Der
Verbund der öffentlich-rechtlichen Landesrundfunkanstalten in Deutschland, der die
Tagesschau produziert und sendet. **ARD-aktuell** ist die gemeinsame Redaktion, die für
die Inhalte dieser API verantwortlich ist.

**Tagesschau-API.** Die nicht dokumentierte, aber offene REST-Schnittstelle hinter
`tagesschau.de`, bereitgestellt unter dem Pfadpräfix **`/api2u`** (z. B.
`https://www.tagesschau.de/api2u/homepage/`). Sie braucht keine Authentifizierung und ist
nur lesbar. Eine Dokumentation der Community gibt es unter
[tagesschau.api.bund.dev](https://tagesschau.api.bund.dev/).

**`/api2u`.** Der Basispfad der API auf dem Host. Jeder Endpoint, den dieser Client
aufruft, lautet `${baseUrl}/api2u/<resource>/` – die Standard-`baseUrl` ist
`https://www.tagesschau.de`.

---

## Ressourcen & Endpoints

Die CLI bildet die Ressourcen der API ab; jede ist ein eigener Befehl auf oberster Ebene.

**Startseite (`/api2u/homepage/`).** Der redaktionell zusammengestellte Feed der
Startseite: die ausgewählten Top-Meldungen plus ein Regionalblock. CLI: `homepage`.
Liefert ein `HomepageResult` (`news`, `regional`).

**Nachrichten (`/api2u/news/`).** Der allgemeine Nachrichten-Feed, optional eingeschränkt
nach **Region(en)** oder nach einem **Ressort** – nicht beidem: Die API wendet dann das
Ressort an und ignoriert die Regionen stillschweigend, deshalb lehnen CLI und Client die
Kombination vor jeder Anfrage ab. CLI: `news`. Liefert ein `NewsResult`
(`news`, `regional`, optional den Cursor `nextPage`).

**Kanäle (`/api2u/channels/`).** Die Live- und Sendekanäle (der Programm-Feed für
lineares Fernsehen und Streaming). CLI: `channels`. Liefert ein `ChannelsResult`
(`channels`).

**Suche (`/api2u/search/`).** Volltextsuche über Artikel. CLI:
`search <text>`. Liefert ein `SearchResult` (`searchResults`, optional
`totalItemCount`).

---

## Filter, Parameter & Kennungen

**Ressort.** Das Thema bzw. die Redaktionsabteilung einer Meldung – der Begriff aus der
Nachrichtenredaktion für eine Nachrichtenkategorie. Der News-Endpoint akzeptiert ein
Ressort über `--ressort`. Die Werte, die der Client bereitstellt (`RessortValues`), sind:
`inland`, `ausland`, `wirtschaft`, `sport`, `video`, `investigativ`, `wissen`.

**Region (Bundesland-ID).** Ein Bundesland, bezeichnet durch eine numerische ID
**`1`–`16`** in der Reihenfolge, in der die API die Bundesländer dokumentiert. Wird dem
News-Endpoint über die wiederholbare Option `--region` übergeben; der Client fügt mehrere
IDs zu einem einzigen kommagetrennten Query-Wert `regions` zusammen (z. B. `?regions=5,9`).
Die zulässigen IDs sind als `RegionValues` bereitgestellt.

**searchText.** Der Freitext-Suchbegriff für den Such-Endpoint (das Positionsargument
`<text>` von `search`). Wird unverändert an die API gesendet; einen leeren Wert lehnt die
CLI bereits clientseitig ab.

**pageSize / resultPage.** Die Paginierungsparameter des Such-Endpoints, bereitgestellt
als `--page-size` / `--result-page`. `pageSize` ist die Zahl der Treffer pro Seite und muss
`>= 1` sein. `resultPage` ist ein **ab 0** gezählter Seitenindex: `0` (der Standard) ist
die erste Seite, ein Index hinter der letzten Seite liefert keine Treffer.

**nextPage.** Eine Cursor-URL, die der News-Endpoint liefert und die auf die nächste
Ergebnisseite zeigt, sofern vorhanden.

**news / regional.** Die beiden Listen, die die Feeds von Startseite und Nachrichten
liefern: der Haupt-Feed und der Regionalblock. Jeder Eintrag ist eine **Meldung**.

**Meldung.** Ein einzelner Beitrag oder Artikel. Ihre Struktur hängt vom Typ ab
(Inhaltsblöcke, Bildvarianten, Tracking-Metadaten), deshalb stellt der Client jede
Meldung als unverändertes Roh-`JsonObject` (`NewsItem`) bereit statt als teilweise
geratenen Typ.

---

## Such- & API-Verhalten

**Keine Authentifizierung.** Die Tagesschau-API ist vollständig offen; dieser Client
sendet weder Schlüssel noch Token noch Cookie. Er stellt nur lesende `GET`-Anfragen.

**Rate-Limiting / vorübergehende Fehler.** Die API erlaubt etwa **60 Anfragen pro
Stunde**. Antwortet sie mit einem vorübergehenden Status (**429** Too Many Requests,
**503** Service Unavailable), wiederholt der Client die Anfrage automatisch, bis zu
`--max-retries`-mal (Standard `2`, höchstens `10`). Jede Wiederholung wartet das
`Retry-After` der Antwort ab (Sekunden oder HTTP-Datum), sofern es höchstens 30 s
beträgt (`MAX_RETRY_AFTER_MS`); ein längeres wird nicht wiederholt, der Fehler kommt
sofort. Ohne brauchbares `Retry-After` wächst die Wartezeit linear (200 ms × Versuch).

**Weiterleitungen.** Der Client folgt bis zu `--max-redirects` Weiterleitungen (Standard
`5`). Bei einem Sprung auf einen **anderen Origin** entfernt er Header mit Zugangsdaten
(`Authorization`, `X-API-Key`, `Cookie`) vor der nächsten Anfrage, damit sie nie an einen
unbeabsichtigten Host gelangen; bei Weiterleitungen innerhalb desselben Origins bleiben
alle Header erhalten.

**Obergrenze der Antwortgröße.** Antworten, die größer als `--max-response-bytes` sind
(Standard **100 MiB**; `0` = unbegrenzt), werden abgebrochen – zum Schutz vor
Speichererschöpfung durch einen feindseligen oder fehlerhaften Endpoint.

---

## Exit-Codes

**Exit-Codes.** Die CLI bildet Ergebnisse auf Exit-Codes des Prozesses ab: `0` bei
Erfolg; `4` bei einem `404` der API; `1` bei jedem anderen Fehler (API-Fehler,
Netzwerkausfall, Unerwartetes); bei Aufruf- bzw. Argumentfehlern ein von null
verschiedener Code von commander. `--help`/`--version` liefern `0`.

---

> **Bibliothek & Interna.** Begriffe zum TypeScript-Client und seinen Interna –
> `TagesschauClient`, die Request-Engine, Transport, Retry/Backoff, Fehlertypen,
> Query-Builder – finden Sie in **[DEVELOPING.md](DEVELOPING.md)** (englisch).
