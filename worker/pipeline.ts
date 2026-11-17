import type { OfferCondition, RunSummary, SourceRunStatus, Watch } from '../shared/types';
import { analyzeOffers, overallVerdict, type TopDeal } from './ai';
import {
  batchInChunks, clearCooldownStatement, cooldownStatement, cooldownsFrom, getSettingsMap, nowIso, toAppSettings,
} from './db';
import type { Env } from './env';
import { median } from './lib/price';
import { canonicalUrl, collapse, fold, parseExcludeKeywords, truncate } from './lib/text';
import { ADAPTERS, searchAllSources, type SourceOffer } from './sources';

/**
 * Nach einer Blockade (403/429/Bot-Check) wird die Quelle so lange nicht mehr angefragt.
 * Kürzer als das Cron-Intervall: jeder Cron-Lauf probiert es genau einmal neu, die übrigen
 * Suchaufträge desselben Laufs (und schnelle manuelle Wiederholungen) überspringen die Quelle.
 */
const COOLDOWN_HOURS = 3;

const SOURCE_LABEL = new Map(ADAPTERS.map((adapter) => [adapter.id, adapter.label]));
const labelOf = (sourceId: string) => SOURCE_LABEL.get(sourceId) ?? sourceId;
/** Fenster für das Gesamt-Fazit ("Top-Empfehlung der Woche"). */
const VERDICT_WINDOW_DAYS = 7;

interface Candidate {
  title: string;
  price: number;
  source: string;
  merchant: string | null;
  url: string;
  imageUrl: string | null;
  condition: OfferCondition;
  referencePrice: number | null;
  snippet: string | null;
}

interface ExistingDeal {
  id: number;
  url: string;
  price: number;
  ai_match: number | null;
}

/** Deterministische Vorfilter: Preis vorhanden, ≤ Maximalpreis, Zustand, Ausschlusswörter, Dubletten. */
export function filterOffers(watch: Pick<Watch, 'max_price' | 'condition' | 'exclude_keywords'>, offers: SourceOffer[]): Candidate[] {
  const excluded = parseExcludeKeywords(watch.exclude_keywords).map(fold);
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const offer of offers) {
    const title = collapse(offer.title);
    const url = canonicalUrl(offer.url);
    if (!title || !url || offer.price === null || !(offer.price > 0)) continue;
    if (watch.max_price !== null && offer.price > watch.max_price) continue;
    const condition = offer.condition ?? 'unknown';
    if (watch.condition === 'new' && condition === 'used') continue;
    if (watch.condition === 'used' && condition === 'new') continue;
    const folded = fold(title);
    if (excluded.some((word) => folded.includes(word))) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      title: truncate(title, 300),
      price: offer.price,
      source: offer.source,
      merchant: offer.merchant ?? null,
      url,
      imageUrl: offer.imageUrl?.startsWith('http') ? offer.imageUrl : null,
      condition,
      referencePrice: offer.referencePrice ?? null,
      snippet: offer.snippet ?? null,
    });
  }
  return out;
}

/**
 * Ein vollständiger Suchlauf für einen Suchauftrag:
 * Quellen abfragen → vorfiltern → neue/preisgeänderte Treffer per KI bewerten →
 * in D1 speichern → Gesamt-Fazit und Lauf-Protokoll (Preisverlauf) schreiben.
 */
export async function runWatch(env: Env, watch: Watch, triggeredBy: 'cron' | 'manual'): Promise<Omit<RunSummary, 'email'>> {
  const startedAt = nowIso();
  const settingsMap = await getSettingsMap(env);
  const settings = toAppSettings(settingsMap);

  // 1) Quellen parallel abfragen (jede für sich gekapselt)
  const { offers, statuses } = await searchAllSources({
    query: watch.query,
    maxPrice: watch.max_price,
    condition: watch.condition,
    env,
    enabled: settings.enabled_sources,
    cooldowns: cooldownsFrom(settingsMap),
  });

  // 2) Vorfiltern und mit dem Bestand abgleichen
  const candidates = filterOffers(watch, offers);
  const { results: existingRows } = await env.DB.prepare('SELECT id, url, price, ai_match FROM deals WHERE watch_id = ?1')
    .bind(watch.id)
    .all<ExistingDeal>();
  const existing = new Map(existingRows.map((row) => [row.url, row]));

  const fresh = candidates.filter((c) => !existing.has(c.url));
  const repriced = candidates.filter((c) => {
    const known = existing.get(c.url);
    return known !== undefined && Math.abs(known.price - c.price) >= 0.01;
  });
  const unchanged = candidates.filter((c) => {
    const known = existing.get(c.url);
    return known !== undefined && Math.abs(known.price - c.price) < 0.01;
  });

  // 3) KI-Bewertung nur für Neues und Preisänderungen. Als Vergleichspreise dienen die bereits
  //    als passend bekannten Treffer dieses Laufs plus die plausiblen neuen (siehe analyzeOffers).
  const toAnalyze = [...fresh, ...repriced];
  const knownGoodPrices = unchanged.filter((c) => existing.get(c.url)!.ai_match === 1).map((c) => c.price);
  const verdicts = await analyzeOffers(
    env,
    watch,
    toAnalyze.map((c) => ({ ...c, source: labelOf(c.source) })),
    knownGoodPrices,
  );
  const usedProviders = new Set(verdicts.map((v) => v.provider));
  // null = in diesem Lauf gab es nichts Neues zu bewerten
  const aiProvider = usedProviders.size === 0 ? null : usedProviders.size === 1 ? [...usedProviders][0] : 'mixed';

  // 4) Speichern
  const finishedAt = nowIso();
  const statements: D1PreparedStatement[] = [];
  toAnalyze.forEach((c, i) => {
    const v = verdicts[i];
    statements.push(
      env.DB.prepare(
        `INSERT INTO deals (watch_id, title, price, source, merchant, url, image_url, condition, reference_price,
                            ai_match, ai_score, ai_summary, ai_provider, found_at, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
         ON CONFLICT (watch_id, url) DO UPDATE SET
           title = excluded.title, price = excluded.price, merchant = excluded.merchant,
           image_url = COALESCE(excluded.image_url, deals.image_url), condition = excluded.condition,
           reference_price = excluded.reference_price, ai_match = excluded.ai_match, ai_score = excluded.ai_score,
           ai_summary = excluded.ai_summary, ai_provider = excluded.ai_provider, last_seen_at = excluded.last_seen_at`,
      ).bind(
        watch.id, c.title, c.price, c.source, c.merchant, c.url, c.imageUrl, c.condition, c.referencePrice,
        v.match ? 1 : 0, v.score, v.summary, v.provider, finishedAt,
      ),
    );
  });
  for (let i = 0; i < unchanged.length; i += 50) {
    const ids = unchanged.slice(i, i + 50).map((c) => existing.get(c.url)!.id);
    statements.push(
      env.DB.prepare(`UPDATE deals SET last_seen_at = ?1 WHERE id IN (${ids.map((_, k) => `?${k + 2}`).join(',')})`).bind(finishedAt, ...ids),
    );
  }
  for (const status of statuses) {
    if (status.blocked) statements.push(cooldownStatement(env, status.id, new Date(Date.now() + COOLDOWN_HOURS * 3_600_000)));
    else if (status.ok) statements.push(clearCooldownStatement(env, status.id));
  }
  await batchInChunks(env, statements);

  // 5) Kennzahlen dieses Laufs (nur passende Treffer, die jetzt gerade gefunden wurden)
  const { results: matchedRows } = await env.DB.prepare(
    'SELECT price FROM deals WHERE watch_id = ?1 AND ai_match = 1 AND last_seen_at = ?2',
  ).bind(watch.id, finishedAt).all<{ price: number }>();
  const matchedPrices = matchedRows.map((row) => row.price);
  const lowestPrice = matchedPrices.length ? Math.min(...matchedPrices) : null;

  // 6) Gesamt-Fazit, sobald sich etwas geändert hat (oder noch keines existiert)
  const tail: D1PreparedStatement[] = [];
  if (toAnalyze.length > 0 || !watch.ai_verdict) {
    const since = new Date(Date.now() - VERDICT_WINDOW_DAYS * 86_400_000).toISOString();
    const { results: top } = await env.DB.prepare(
      `SELECT title, price, source, merchant, ai_score AS score FROM deals
       WHERE watch_id = ?1 AND ai_match = 1 AND last_seen_at >= ?2
       ORDER BY ai_score DESC, price ASC LIMIT 5`,
    ).bind(watch.id, since).all<TopDeal>();
    const verdict = await overallVerdict(env, watch, top.map((deal) => ({ ...deal, source: labelOf(deal.source) })));
    tail.push(
      env.DB.prepare('UPDATE watches SET last_checked_at = ?1, ai_verdict = ?2, ai_verdict_at = ?1 WHERE id = ?3')
        .bind(finishedAt, verdict, watch.id),
    );
  } else {
    tail.push(env.DB.prepare('UPDATE watches SET last_checked_at = ?1 WHERE id = ?2').bind(finishedAt, watch.id));
  }

  const sources: SourceRunStatus[] = statuses;
  tail.push(
    env.DB.prepare(
      `INSERT INTO watch_runs (watch_id, triggered_by, started_at, finished_at, found_count, new_count, match_count,
                               lowest_price, median_price, ai_provider, sources_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    ).bind(
      watch.id, triggeredBy, startedAt, finishedAt, candidates.length, fresh.length, matchedPrices.length,
      lowestPrice, median(matchedPrices), aiProvider, JSON.stringify(sources),
    ),
  );
  await env.DB.batch(tail);

  return {
    watch_id: watch.id,
    found: candidates.length,
    new: fresh.length,
    matched: matchedPrices.length,
    lowest_price: lowestPrice,
    ai_provider: aiProvider,
    sources,
  };
}

/** Cron: die am längsten nicht geprüften aktiven Suchaufträge nacheinander ausführen. */
export async function runDueWatches(env: Env): Promise<number[]> {
  const limit = Math.max(1, Math.min(50, Number(env.MAX_WATCHES_PER_RUN) || 10));
  const { results } = await env.DB.prepare(
    'SELECT * FROM watches WHERE is_active = 1 ORDER BY last_checked_at IS NOT NULL, last_checked_at ASC LIMIT ?1',
  ).bind(limit).all<Watch>();

  const done: number[] = [];
  for (const watch of results) {
    try {
      const summary = await runWatch(env, watch, 'cron');
      console.log(`[cron] "${watch.query}": ${summary.found} Treffer, ${summary.new} neu`);
      done.push(watch.id);
    } catch (error) {
      // Ein fehlgeschlagener Suchauftrag darf die übrigen nicht aufhalten.
      console.error(`[cron] Suchauftrag ${watch.id} fehlgeschlagen:`, error);
    }
  }
  return done;
}
