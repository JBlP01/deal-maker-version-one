import { Hono } from 'hono';
import type {
  AppSettings, AppStatus, Deal, DealSort, RunSummary, SourceRunStatus, Watch, WatchInput, WatchRun, WatchWithStats,
} from '../../shared/types';
import { isAiReady, resolveAiProvider } from '../ai';
import { cooldownsFrom, getSettingsMap, getWatch, setSettingStatement, toAppSettings } from '../db';
import { buildDigest } from '../email/digest';
import { notifyTopDeals, resolveRecipient, sendWithResend } from '../email/notify';
import type { Env } from '../env';
import { parseExcludeKeywords } from '../lib/text';
import { runWatch } from '../pipeline';
import { ADAPTERS } from '../sources';
import { resolveSearchProvider } from '../sources/websearch';

/** Angebote, die länger nicht mehr gefunden wurden, verschwinden aus dem Feed (bleiben aber gespeichert). */
const FRESH_DAYS = 14;
const CONDITIONS = ['any', 'new', 'used'] as const;

class ValidationError extends Error {}

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Ungültige ID');
  return id;
}

function validateWatch(body: unknown, partial: boolean): Partial<Record<keyof Watch, string | number | null>> {
  if (!body || typeof body !== 'object') throw new ValidationError('JSON-Objekt erwartet');
  const input = body as WatchInput;
  const out: Partial<Record<keyof Watch, string | number | null>> = {};

  if (input.query !== undefined || !partial) {
    const query = typeof input.query === 'string' ? input.query.replace(/\s+/g, ' ').trim() : '';
    if (query.length < 2 || query.length > 120) throw new ValidationError('Der Suchbegriff muss 2–120 Zeichen lang sein');
    out.query = query;
  }
  if (input.max_price !== undefined) {
    if (input.max_price === null || (input.max_price as unknown) === '') out.max_price = null;
    else {
      const price = Number(input.max_price);
      if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) throw new ValidationError('Ungültiger Maximalpreis');
      out.max_price = Math.round(price * 100) / 100;
    }
  }
  if (input.condition !== undefined) {
    if (!CONDITIONS.includes(input.condition)) throw new ValidationError('Zustand muss any, new oder used sein');
    out.condition = input.condition;
  }
  if (input.exclude_keywords !== undefined) {
    if (typeof input.exclude_keywords !== 'string' || input.exclude_keywords.length > 300) {
      throw new ValidationError('Ungültige Ausschlusswörter');
    }
    out.exclude_keywords = parseExcludeKeywords(input.exclude_keywords).join(',');
  }
  if (input.is_active !== undefined) out.is_active = input.is_active ? 1 : 0;
  return out;
}

export const api = new Hono<{ Bindings: Env }>();

api.onError((error, c) => {
  if (error instanceof ValidationError) return c.json({ error: error.message }, 400);
  if (error instanceof SyntaxError) return c.json({ error: 'Ungültiges JSON' }, 400);
  console.error('[api]', error);
  const message = error instanceof Error ? error.message : String(error);
  // Häufigster Einrichtungsfehler: Migrationen wurden noch nicht angewendet.
  if (/no such table/i.test(message)) {
    return c.json({ error: 'Die Datenbank ist noch nicht initialisiert. Bitte Migrationen anwenden (siehe README).' }, 500);
  }
  return c.json({ error: 'Interner Fehler' }, 500);
});

// --- Zugriffsschutz (optional über APP_PASSWORD) -------------------------------

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

api.get('/auth', (c) => c.json({ required: Boolean(c.env.APP_PASSWORD) }));

api.use('*', async (c, next) => {
  const password = c.env.APP_PASSWORD;
  if (!password) return next();
  const given = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  // Hash-Vergleich, damit die Antwortzeit nichts über das Passwort verrät.
  if ((await sha256(given)) !== (await sha256(password))) return c.json({ error: 'Nicht angemeldet' }, 401);
  return next();
});

// --- Status ------------------------------------------------------------------

api.get('/status', async (c) => {
  const map = await getSettingsMap(c.env);
  const settings = toAppSettings(map);
  const cooldowns = cooldownsFrom(map);
  const now = Date.now();
  const status: AppStatus = {
    ai_provider: resolveAiProvider(c.env),
    ai_ready: isAiReady(c.env),
    search_provider: resolveSearchProvider(c.env),
    email_ready: Boolean(c.env.RESEND_API_KEY) && resolveRecipient(c.env, settings.notification_email) !== null,
    email_recipient_source: settings.notification_email.trim() ? 'settings' : c.env.NOTIFICATION_EMAIL ? 'env' : 'none',
    sources: ADAPTERS.map((a) => ({
      id: a.id,
      label: a.label,
      description: a.description,
      experimental: Boolean(a.experimental),
      enabled: settings.enabled_sources.includes(a.id),
      cooldown_until: cooldowns[a.id] && Date.parse(cooldowns[a.id]) > now ? cooldowns[a.id] : null,
    })),
    cron: '0 */6 * * *',
  };
  return c.json(status);
});

// --- Suchaufträge ------------------------------------------------------------

const WATCH_WITH_STATS = `
  SELECT w.*,
    (SELECT COUNT(*)      FROM deals d WHERE d.watch_id = w.id AND d.ai_match = 1 AND d.last_seen_at >= ?1) AS deal_count,
    (SELECT MIN(d.price)  FROM deals d WHERE d.watch_id = w.id AND d.ai_match = 1 AND d.last_seen_at >= ?1) AS lowest_price,
    (SELECT MAX(d.ai_score) FROM deals d WHERE d.watch_id = w.id AND d.ai_match = 1 AND d.last_seen_at >= ?1) AS best_score
  FROM watches w`;

const freshSince = () => new Date(Date.now() - FRESH_DAYS * 86_400_000).toISOString();

api.get('/watches', async (c) => {
  const { results } = await c.env.DB.prepare(`${WATCH_WITH_STATS} ORDER BY w.created_at DESC`).bind(freshSince()).all<WatchWithStats>();
  return c.json(results);
});

api.post('/watches', async (c) => {
  const input = validateWatch(await c.req.json(), false);
  const row = await c.env.DB.prepare(
    `INSERT INTO watches (query, max_price, condition, exclude_keywords, is_active)
     VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`,
  ).bind(input.query, input.max_price ?? null, input.condition ?? 'any', input.exclude_keywords ?? '', input.is_active ?? 1)
    .first<{ id: number }>();
  return c.json(await getWatch(c.env, row!.id), 201);
});

api.patch('/watches/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  const fields = Object.entries(validateWatch(await c.req.json(), true));
  if (fields.length > 0) {
    // Spaltennamen stammen aus validateWatch (feste Liste), Werte werden gebunden.
    const assignments = fields.map(([column], i) => `${column} = ?${i + 1}`).join(', ');
    await c.env.DB.prepare(`UPDATE watches SET ${assignments} WHERE id = ?${fields.length + 1}`)
      .bind(...fields.map(([, value]) => value), id).run();
  }
  const watch = await getWatch(c.env, id);
  return watch ? c.json(watch) : c.json({ error: 'Suchauftrag nicht gefunden' }, 404);
});

api.delete('/watches/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  // Explizit in einer Transaktion löschen – unabhängig davon, ob Fremdschlüssel-Kaskaden aktiv sind.
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM deals WHERE watch_id = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM watch_runs WHERE watch_id = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM watches WHERE id = ?1').bind(id),
  ]);
  return c.json({ ok: true });
});

/** "Jetzt suchen": Suchlauf sofort ausführen und – falls konfiguriert – den Digest verschicken. */
api.post('/watches/:id/run', async (c) => {
  const watch = await getWatch(c.env, parseId(c.req.param('id')));
  if (!watch) return c.json({ error: 'Suchauftrag nicht gefunden' }, 404);
  const summary = await runWatch(c.env, watch, 'manual');
  const email = await notifyTopDeals(c.env, [watch.id], new URL(c.req.url).origin);
  return c.json({ ...summary, email } satisfies RunSummary);
});

/** Lauf-Protokoll = Preisverlauf (Tiefstpreis je Lauf), älteste zuerst. */
api.get('/watches/:id/runs', async (c) => {
  const id = parseId(c.req.param('id'));
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM (SELECT * FROM watch_runs WHERE watch_id = ?1 ORDER BY started_at DESC LIMIT 120) ORDER BY started_at ASC`,
  ).bind(id).all<Omit<WatchRun, 'sources'> & { sources_json: string }>();
  const runs: WatchRun[] = results.map(({ sources_json, ...run }) => {
    let sources: SourceRunStatus[] = [];
    try { sources = JSON.parse(sources_json) as SourceRunStatus[]; } catch { /* leer lassen */ }
    return { ...run, sources };
  });
  return c.json(runs);
});

// --- Deals -------------------------------------------------------------------

const SORTS: Record<DealSort, string> = {
  score: 'd.ai_score DESC, d.price ASC',
  price: 'd.price ASC, d.ai_score DESC',
  recent: 'd.found_at DESC, d.ai_score DESC',
};

api.get('/deals', async (c) => {
  const q = c.req.query();
  const where = ['d.last_seen_at >= ?1'];
  const params: Array<string | number> = [freshSince()];
  if (q.watch_id) {
    params.push(parseId(q.watch_id));
    where.push(`d.watch_id = ?${params.length}`);
  }
  if (q.include_rejected !== '1') where.push('d.ai_match = 1');
  const minScore = Number(q.min_score);
  if (Number.isInteger(minScore) && minScore > 1) {
    params.push(Math.min(minScore, 10));
    where.push(`d.ai_score >= ?${params.length}`);
  }
  if (q.source && ADAPTERS.some((a) => a.id === q.source)) {
    params.push(q.source);
    where.push(`d.source = ?${params.length}`);
  }
  const sort = SORTS[(q.sort as DealSort) in SORTS ? (q.sort as DealSort) : 'score'];
  const limit = Math.max(1, Math.min(200, Number(q.limit) || 60));
  const { results } = await c.env.DB.prepare(
    `SELECT d.*, w.query AS watch_query FROM deals d JOIN watches w ON w.id = d.watch_id
     WHERE ${where.join(' AND ')} ORDER BY ${sort} LIMIT ${limit}`,
  ).bind(...params).all<Deal>();
  return c.json(results);
});

// --- Einstellungen -----------------------------------------------------------

api.get('/settings', async (c) => c.json(toAppSettings(await getSettingsMap(c.env))));

api.put('/settings', async (c) => {
  const body = (await c.req.json()) as Partial<AppSettings>;
  const statements: D1PreparedStatement[] = [];
  if (body.notification_email !== undefined) {
    const email = String(body.notification_email).trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('Ungültige E-Mail-Adresse');
    statements.push(setSettingStatement(c.env, 'notification_email', email));
  }
  if (body.notify_min_score !== undefined) {
    const score = Number(body.notify_min_score);
    if (!Number.isInteger(score) || score < 1 || score > 10) throw new ValidationError('Schwellenwert muss zwischen 1 und 10 liegen');
    statements.push(setSettingStatement(c.env, 'notify_min_score', String(score)));
  }
  if (body.notify_below_max_price !== undefined) {
    statements.push(setSettingStatement(c.env, 'notify_below_max_price', body.notify_below_max_price ? '1' : '0'));
  }
  if (body.enabled_sources !== undefined) {
    if (!Array.isArray(body.enabled_sources)) throw new ValidationError('enabled_sources muss eine Liste sein');
    const valid = ADAPTERS.map((a) => a.id).filter((id) => body.enabled_sources!.includes(id));
    statements.push(setSettingStatement(c.env, 'enabled_sources', valid.join(',')));
  }
  if (statements.length > 0) await c.env.DB.batch(statements);
  return c.json(toAppSettings(await getSettingsMap(c.env)));
});

api.post('/settings/test-email', async (c) => {
  const settings = toAppSettings(await getSettingsMap(c.env));
  const recipient = resolveRecipient(c.env, settings.notification_email);
  if (!recipient) return c.json({ error: 'Kein gültiger E-Mail-Empfänger hinterlegt' }, 400);
  if (!c.env.RESEND_API_KEY) return c.json({ error: 'RESEND_API_KEY ist nicht gesetzt' }, 400);
  const origin = new URL(c.req.url).origin;
  const digest = buildDigest(
    [{
      id: 0, watch_query: 'Test-Suchauftrag', watch_max_price: 100, title: 'Beispiel-Deal: So sieht eine Benachrichtigung aus',
      price: 79.99, source: 'mydealz', merchant: 'Beispielshop', url: origin, image_url: null, ai_score: 9,
      ai_summary: 'Dies ist eine Test-E-Mail von DealScout AI. Echte Benachrichtigungen enthalten hier die KI-Kurzanalyse.',
    }],
    origin,
  );
  try {
    await sendWithResend(c.env, recipient, { ...digest, subject: 'DealScout AI – Test-Benachrichtigung' });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
  return c.json({ ok: true, recipient });
});

api.all('*', (c) => c.json({ error: 'Nicht gefunden' }, 404));
