-- DealScout AI – vollständiges D1-Schema (idempotent).
-- Identisch mit migrations/0001_init.sql; für die manuelle Initialisierung:
--   npx wrangler d1 execute dealscout-db --local  --file=./schema.sql
--   npx wrangler d1 execute dealscout-db --remote --file=./schema.sql

-- Suchaufträge (Watchlists)
CREATE TABLE IF NOT EXISTS watches (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  query            TEXT    NOT NULL,
  max_price        REAL,                                   -- optionaler Maximal-/Wunschpreis in EUR
  condition        TEXT    NOT NULL DEFAULT 'any' CHECK (condition IN ('any', 'new', 'used')),
  exclude_keywords TEXT    NOT NULL DEFAULT '',            -- kommagetrennt, z. B. "defekt,karton"
  is_active        INTEGER NOT NULL DEFAULT 1,
  last_checked_at  TEXT,
  ai_verdict       TEXT,                                   -- Gesamt-Fazit ("Top-Empfehlung der Woche")
  ai_verdict_at    TEXT,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Gefundene Angebote
CREATE TABLE IF NOT EXISTS deals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id        INTEGER NOT NULL REFERENCES watches (id) ON DELETE CASCADE,
  title           TEXT    NOT NULL,
  price           REAL    NOT NULL,
  currency        TEXT    NOT NULL DEFAULT 'EUR',
  source          TEXT    NOT NULL,                        -- Adapter-ID: mydealz, kleinanzeigen, websearch …
  merchant        TEXT,                                    -- Händler/Domain, falls bekannt
  url             TEXT    NOT NULL,
  image_url       TEXT,
  condition       TEXT    NOT NULL DEFAULT 'unknown' CHECK (condition IN ('new', 'used', 'unknown')),
  reference_price REAL,                                    -- Vergleichspreis laut Quelle
  ai_match        INTEGER,                                 -- 1 = passt, 0 = von der KI aussortiert
  ai_score        INTEGER,                                 -- Deal-Score 1–10
  ai_summary      TEXT,
  ai_provider     TEXT,
  is_notified     INTEGER NOT NULL DEFAULT 0,
  found_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Eine URL je Suchauftrag. (Global eindeutig wäre falsch, sobald zwei Suchaufträge
  -- dasselbe Angebot finden; E-Mail-Duplikate werden zusätzlich über die URL verhindert.)
  UNIQUE (watch_id, url)
);

CREATE INDEX IF NOT EXISTS idx_deals_watch_score ON deals (watch_id, ai_score DESC);
CREATE INDEX IF NOT EXISTS idx_deals_watch_price ON deals (watch_id, price);
CREATE INDEX IF NOT EXISTS idx_deals_found_at    ON deals (found_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_url         ON deals (url);

-- Protokoll je Suchlauf; liefert zugleich den Preisverlauf (Tiefstpreis je Lauf)
CREATE TABLE IF NOT EXISTS watch_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id      INTEGER NOT NULL REFERENCES watches (id) ON DELETE CASCADE,
  triggered_by  TEXT    NOT NULL DEFAULT 'cron',           -- cron | manual
  started_at    TEXT    NOT NULL,
  finished_at   TEXT    NOT NULL,
  found_count   INTEGER NOT NULL DEFAULT 0,
  new_count     INTEGER NOT NULL DEFAULT 0,
  match_count   INTEGER NOT NULL DEFAULT 0,
  lowest_price  REAL,
  median_price  REAL,
  ai_provider   TEXT,
  sources_json  TEXT    NOT NULL DEFAULT '[]'              -- Status je Quelle (ok/Fehler/blockiert)
);

CREATE INDEX IF NOT EXISTS idx_runs_watch ON watch_runs (watch_id, started_at DESC);

-- Schlüssel/Wert-Einstellungen (E-Mail-Empfänger, Schwellenwerte, Quellen, Cooldowns)
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('notification_email', ''),
  ('notify_min_score', '8'),
  ('notify_below_max_price', '1'),
  ('enabled_sources', 'websearch,mydealz,kleinanzeigen');
