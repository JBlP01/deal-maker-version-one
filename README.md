# DealScout AI

Sucht automatisch nach Produkt-Deals auf mehreren Websites, sortiert unpassende Treffer per KI aus, bewertet jedes
Angebot mit einem Deal-Score (1–10) und meldet Top-Deals per E-Mail. Läuft komplett auf Cloudflare
(Workers, D1, Workers AI, Cron Triggers) und kommt ohne kostenpflichtige Dienste aus.

- **Suchaufträge** mit Maximalpreis, Zustand (neu/gebraucht) und Ausschlusswörtern – pausieren, sofort ausführen, löschen
- **Mehrere Quellen parallel**: Web-Suche (Brave / Serper.dev / DuckDuckGo), MyDealz, Kleinanzeigen, optional Geizhals und Idealo
- **KI-Analyse**: Filterung (Zubehör, Gesuche, Scam-Verdacht), Deal-Score, 2-Satz-Zusammenfassung, Gesamt-Fazit „Top-Empfehlung der Woche“
- **Dashboard** (React, Tailwind, Dark Mode als Standard): Deal-Feed, Vergleichstabelle, Preisverlauf, Filter und Sortierung
- **E-Mail-Digest** über Resend für neue Top-Deals – jede URL wird nur einmal gemeldet
- **Automatik**: Cron Trigger alle 6 Stunden

## Architektur

```
Browser ──► Cloudflare Worker "dealscout-ai"
              ├─ /api/*        Hono-API            (worker/routes/api.ts)
              ├─ alles andere  gebautes Frontend   (Static Assets, SPA)
              └─ scheduled()   Cron alle 6 h       (worker/index.ts)
                    │
                    ├─ Quellen-Adapter  worker/sources/*   (parallel, einzeln gekapselt)
                    ├─ KI-Bewertung     worker/ai/*        (Workers AI | Gemini | Groq | Heuristik)
                    ├─ D1 (SQLite)      schema.sql, migrations/
                    └─ E-Mail           worker/email/*     (Resend)
```

**Warum ein Worker statt Cloudflare Pages?** Pages Functions unterstützen keine Cron Triggers. Deshalb ist das Projekt
ein einzelner Worker mit *Static Assets* (dem Nachfolger von Pages): ein `wrangler.toml`, ein Deploy-Befehl, und Frontend,
API und Cron liegen im selben Deployment. Entsprechend ersetzt `npm run dev` das früher übliche `wrangler pages dev`.

| Pfad | Inhalt |
| --- | --- |
| `src/` | Frontend (React + Vite + Tailwind CSS + Lucide Icons) |
| `worker/` | Backend: Hono-API, Pipeline, Quellen, KI, E-Mail |
| `shared/types.ts` | Typen, die Frontend und Backend teilen |
| `schema.sql`, `migrations/` | D1-Schema und Migrationen |
| `test/` | Unit-Tests (Parser gegen echtes Seiten-Markup, Preis-Parsing, KI-Antworten, Digest) |

## Voraussetzungen

- Node.js 22 oder neuer
- Ein Cloudflare-Konto (der Free-Plan genügt zum Start, siehe [Limits](#limits-im-cloudflare-free-plan))

## Lokal testen

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

```bash
npm run db:migrate:local
```

Danach eine der beiden Varianten starten und <http://localhost:5173> öffnen:

```bash
npm run dev
```

`npm run dev` nutzt Workers AI auch lokal über dein Cloudflare-Konto und braucht dafür einmalig `npx wrangler login`.

```bash
npm run dev:offline
```

`npm run dev:offline` läuft ohne Cloudflare-Konto. Die Bewertung übernimmt dann Gemini/Groq (falls in `.dev.vars`
konfiguriert) oder eine regelbasierte Heuristik; der Rest verhält sich identisch.

Beide Varianten starten Vite und führen den Worker in der echten Workers-Runtime aus – Frontend, API und die lokale
D1-Datenbank (`.wrangler/state`) laufen auf einem Port.

Den Cron-Lauf lokal auslösen (bei laufendem Dev-Server):

```bash
npm run cron:local
```

Den Produktions-Build lokal prüfen (`wrangler dev` auf Port 8787):

```bash
npm run preview
```

Tests und Typprüfung:

```bash
npm test
```

```bash
npm run typecheck
```

## Deployment auf Cloudflare

Einmalige Einrichtung:

1. Anmelden:

   ```bash
   npx wrangler login
   ```

2. D1-Datenbank anlegen:

   ```bash
   npm run db:create
   ```

   Die ausgegebene `database_id` in `wrangler.toml` unter `[[d1_databases]]` eintragen (ersetzt die Nullen).

3. Bauen, Migrationen anwenden und deployen – **ein Befehl, auch für jedes spätere Update**:

   ```bash
   npm run deploy
   ```

4. Secrets setzen (alle optional, siehe [Konfiguration](#konfiguration)); sie gelten sofort, ohne erneutes Deploy:

   ```bash
   npx wrangler secret put RESEND_API_KEY
   ```

   ```bash
   npx wrangler secret put NOTIFICATION_EMAIL
   ```

   ```bash
   npx wrangler secret put APP_PASSWORD
   ```

Die App ist danach unter `https://dealscout-ai.<dein-subdomain>.workers.dev` erreichbar. Der Cron Trigger aus
`wrangler.toml` (`0 */6 * * *`, UTC) wird beim Deploy automatisch registriert.

Wer die Datenbank lieber ohne Migrationen initialisiert, kann stattdessen `npm run db:schema:remote` (bzw.
`db:schema:local`) verwenden – `schema.sql` ist idempotent und inhaltsgleich mit `migrations/0001_init.sql`.

> **Zugriffsschutz:** Ohne `APP_PASSWORD` kann jeder, der die URL kennt, Suchaufträge anlegen und die E-Mail-Adresse
> ändern. Setze für Produktion `APP_PASSWORD` (das Dashboard fragt dann danach) oder schütze die Domain mit
> Cloudflare Access.

## Konfiguration

Nicht geheime Werte stehen in `wrangler.toml` unter `[vars]`, Secrets in `.dev.vars` (lokal) bzw. `wrangler secret put`.

| Name | Art | Bedeutung |
| --- | --- | --- |
| `AI_PROVIDER` | Variable | `workers-ai` (Standard), `gemini`, `groq` oder `none` |
| `WORKERS_AI_MODEL` | Variable | Standard `@cf/meta/llama-3.1-8b-instruct` |
| `GEMINI_MODEL` / `GROQ_MODEL` | Variable | Modellnamen für die Alternativ-Anbieter |
| `GEMINI_API_KEY` / `GROQ_API_KEY` | Secret | nur für `AI_PROVIDER=gemini` bzw. `groq` |
| `SEARCH_PROVIDER` | Variable | `auto` (Standard), `brave`, `serper`, `duckduckgo` |
| `SEARCH_API_KEY` | Secret | Key für Brave Search oder Serper.dev; ohne Key wird DuckDuckGo genutzt |
| `RESEND_API_KEY` | Secret | aktiviert den E-Mail-Versand |
| `NOTIFICATION_EMAIL` | Secret | Standard-Empfänger; im Dashboard überschreibbar |
| `EMAIL_FROM` | Variable | Absender, Standard `DealScout AI <onboarding@resend.dev>` |
| `APP_PASSWORD` | Secret | Passwortschutz für Dashboard und API |
| `MAX_WATCHES_PER_RUN` | Variable | Obergrenze an Suchaufträgen je Cron-Lauf (Standard 10, die am längsten nicht geprüften zuerst) |

Im Dashboard unter **Einstellungen** (gespeichert in der Tabelle `settings`): E-Mail-Empfänger, Score-Schwellenwert,
„unter Wunschpreis melden“ und die aktiven Quellen.

### KI

Workers AI braucht keinen Key – das `[ai]`-Binding und das kostenlose Tageskontingent des Kontos genügen. Fällt die KI
aus (Kontingent leer, ungültige Antwort, kein Key), bewertet eine regelbasierte Heuristik (Zubehör-Wörter, Preis relativ
zum Median der passenden Treffer). Ein Suchlauf schlägt deshalb nie wegen der KI fehl; im Dashboard steht bei jedem Deal,
wer bewertet hat.

Bewertet werden nur neue Angebote und solche mit geändertem Preis, in Stapeln von 10 Angeboten (höchstens 4 KI-Aufrufe
je Suchlauf plus einer für das Gesamt-Fazit).

### Quellen

| Quelle | Standard | Stand |
| --- | --- | --- |
| Web-Suche (Brave / Serper / DuckDuckGo) | an | DuckDuckGo live getestet; liefert Treffer nur, wenn im Snippet ein Preis steht, und verlangt von Server-IPs gelegentlich eine Bot-Prüfung. Brave- und Serper-Parser sind nur gegen Beispielantworten getestet (kein Key vorhanden). |
| MyDealz | an | live getestet |
| Kleinanzeigen | an | live getestet |
| Geizhals, Idealo | aus | **experimentell**: beide wiesen im Test jede Server-Anfrage per Bot-Schutz ab (HTTP 403), die Parser konnten deshalb nicht gegen die echten Seiten geprüft werden |

Jede Quelle ist einzeln gekapselt (Timeout, höflicher Mindestabstand je Host, ein Retry). Antwortet eine Quelle mit
403/429 oder einer Bot-Check-Seite, wird sie für 3 Stunden pausiert; der Lauf geht mit den übrigen weiter. Der Status je
Quelle steht nach jedem Suchlauf im Dashboard.

Eine neue Quelle hinzufügen: `SourceAdapter` aus `worker/sources/types.ts` implementieren und in
`worker/sources/index.ts` in `ADAPTERS` eintragen.

Bitte beachte die Nutzungsbedingungen der abgefragten Seiten. Das Tool ist für den privaten Gebrauch mit wenigen
Suchaufträgen gedacht, nicht für Massenabfragen.

### E-Mail

Ein Digest geht raus, sobald ein neues, passendes Angebot den Score-Schwellenwert erreicht (Standard 8) **oder** unter
dem Wunschpreis des Suchauftrags liegt. Schlägt der Versand fehl, bleibt das Angebot unmarkiert und wird beim nächsten
Lauf erneut versucht.

Mit dem Absender `onboarding@resend.dev` stellt Resend nur an die E-Mail-Adresse des eigenen Resend-Kontos zu. Für andere
Empfänger eine Domain bei Resend verifizieren und `EMAIL_FROM` anpassen.

## Datenbank

`watches`, `deals` und `settings` wie vorgegeben, mit diesen Ergänzungen:

- `deals` ist über `(watch_id, url)` eindeutig statt über `url` allein – sonst ginge ein Angebot verloren, sobald zwei
  Suchaufträge es finden. Doppelte E-Mails verhindert die Benachrichtigung trotzdem URL-weit.
- `deals` hat zusätzlich `merchant`, `condition`, `reference_price`, `ai_match`, `ai_provider`, `last_seen_at`.
- `watches` speichert das Gesamt-Fazit (`ai_verdict`, `ai_verdict_at`).
- `watch_runs` protokolliert jeden Suchlauf (Treffer, Status je Quelle) und liefert den Preisverlauf (Tiefstpreis je Lauf).

Angebote, die 14 Tage lang nicht mehr gefunden wurden, verschwinden aus dem Feed, bleiben aber gespeichert.

## API

| Methode | Pfad | Zweck |
| --- | --- | --- |
| GET | `/api/status` | aktive Anbieter, Quellen, Cooldowns |
| GET / POST | `/api/watches` | Suchaufträge auflisten / anlegen |
| PATCH / DELETE | `/api/watches/:id` | bearbeiten, pausieren (`is_active`) / löschen |
| POST | `/api/watches/:id/run` | „Jetzt suchen“ |
| GET | `/api/watches/:id/runs` | Lauf-Protokoll und Preisverlauf |
| GET | `/api/deals` | Feed; Parameter `watch_id`, `sort` (`score`/`price`/`recent`), `min_score`, `source`, `include_rejected`, `limit` |
| GET / PUT | `/api/settings` | Einstellungen |
| POST | `/api/settings/test-email` | Test-E-Mail senden |

Mit gesetztem `APP_PASSWORD` erwartet die API den Header `Authorization: Bearer <Passwort>`.

## Limits im Cloudflare-Free-Plan

- **CPU-Zeit: 10 ms je Aufruf.** Das ist der engste Punkt. Netzwerk-Wartezeit zählt nicht, das Parsen schon: lokal
  gemessen etwa 0,3 ms für eine MyDealz-Seite und 4–7 ms für eine Kleinanzeigen-Seite (~750 KB). Ein Cron-Lauf mit
  mehreren Suchaufträgen kann das Limit also überschreiten; Cloudflare bricht den Lauf dann ab. Ob und ab wann das
  passiert, konnte hier nicht gegen ein echtes Konto getestet werden. Abhilfe: `MAX_WATCHES_PER_RUN` senken, Kleinanzeigen
  abschalten oder Workers Paid nutzen (dort gelten 15 Minuten CPU-Zeit je Cron-Lauf).
- **50 externe Anfragen je Aufruf.** Ein Suchauftrag braucht je aktiver Quelle eine Anfrage (plus ggf. einen Retry);
  Gemini/Groq zählen zusätzlich, Workers AI und D1 nicht.
- **Workers AI** hat ein kostenloses Tageskontingent; ist es aufgebraucht, greift die Heuristik.

Aktuelle Werte: <https://developers.cloudflare.com/workers/platform/limits/>
