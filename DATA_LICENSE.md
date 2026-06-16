# Data license

> **This tool does not include, host, or redistribute any data.**
> `tagesschau-cli` is a *client*. It only accesses content served live by
> **ARD-aktuell / NDR** via the Tagesschau API. That content belongs to the
> broadcaster and is governed by **their** terms, summarized below. The license of
> this CLI's own source code is a separate matter — see [LICENSING.md](LICENSING.md).

> [!CAUTION]
> **This is copyrighted editorial content, not open data.** News text, images,
> audio and video are journalistic works under copyright held by ARD/ARD-aktuell,
> NDR and contributing authors. Use is for **private, non-commercial** purposes
> only — **do not republish or redistribute**. "Look, but don't publish."

| | |
|---|---|
| **Content provider** | ARD-aktuell (under NDR) |
| **API / source** | `https://www.tagesschau.de/api2u` · docs: https://tagesschau.api.bund.dev/ (community-maintained, **not** an official ARD program) |
| **Content license** | **Proprietary / copyrighted.** A narrow, explicitly-listed subset of videos is offered under **CC BY-NC-ND 4.0 DE**. |
| **Authoritative terms** | https://www.tagesschau.de/nutzungsbedingungen · https://www.tagesschau.de/impressum · CC subset: https://www.tagesschau.de/creativecommons/ |
| **Attribution** | No general reuse license to attribute under; required for the CC-listed videos only. |
| **Commercial use** | **Prohibited.** |
| **Redistribution / modification** | **Not permitted** for general content. CC subset is **ND** (no derivatives) — verbatim copies only. |

## Notes & caveats

- The community docs state plainly: *"Die Nutzung der Inhalte für den privaten,
  nicht-kommerziellen Gebrauch ist gestattet, die Veröffentlichung hingegen nicht."*
- A documented **rate limit** applies: **no more than 60 requests per hour**.
- The API is **community-documented** (bundesAPI), not an official ARD product —
  no formal terms-of-service or SLA; access can change or break at any time.
- Broadcasting-law considerations: public-broadcaster content can be subject to
  **Depublizierung** (time-limited online availability under the Medienstaatsvertrag),
  and some sport/film footage carries additional third-party rights.

## Attribution

```
Quelle: tagesschau.de (ARD-aktuell / NDR) — Inhalte urheberrechtlich geschützt;
Abruf nur für den privaten, nicht-kommerziellen Gebrauch. Veröffentlichung/
Weiterverbreitung nicht gestattet (Ausnahme: ausdrücklich CC-BY-NC-ND-lizenzierte
Inhalte unter tagesschau.de/creativecommons).
```

## Sources

- https://github.com/bundesAPI/tagesschau-api — community API docs (private/non-commercial only; 60 req/h)
- https://www.tagesschau.de/creativecommons/ — the only content under an open license (CC BY-NC-ND 4.0 DE)

---

*Good-faith summary compiled 2026-06-16; not legal advice. This is rights-restricted
editorial content. Do not republish, redistribute, or use commercially. The
provider's terms are authoritative and can change — verify at the source.*
