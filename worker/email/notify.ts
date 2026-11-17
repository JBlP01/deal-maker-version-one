import type { EmailOutcome } from '../../shared/types';
import { getSettingsMap, toAppSettings } from '../db';
import type { Env } from '../env';
import { buildDigest, type DigestDeal, type DigestEmail } from './digest';

const MAX_DEALS_PER_DIGEST = 20;
const MAX_AGE_DAYS = 7;

export function resolveRecipient(env: Env, settingsEmail: string): string | null {
  const recipient = settingsEmail.trim() || env.NOTIFICATION_EMAIL?.trim() || '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) ? recipient : null;
}

export async function sendWithResend(env: Env, to: string, email: DigestEmail): Promise<void> {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY fehlt');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM || 'DealScout AI <onboarding@resend.dev>',
      to: [to],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Resend HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
}

/**
 * Verschickt einen Digest mit allen noch nicht gemeldeten Top-Deals
 * (Score ≥ Schwellenwert oder Preis ≤ Wunschpreis) der angegebenen Suchaufträge.
 * Eine URL wird nie doppelt gemeldet – auch nicht, wenn zwei Suchaufträge sie finden.
 */
export async function notifyTopDeals(env: Env, watchIds: number[], dashboardUrl?: string): Promise<EmailOutcome> {
  if (watchIds.length === 0) return { sent: 0, skipped: 'nothing_new' };
  const settings = toAppSettings(await getSettingsMap(env));
  const recipient = resolveRecipient(env, settings.notification_email);
  if (!recipient || !env.RESEND_API_KEY) return { sent: 0, skipped: 'not_configured' };

  const since = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000).toISOString();
  const placeholders = watchIds.map((_, i) => `?${i + 4}`).join(',');
  const { results } = await env.DB.prepare(
    `SELECT d.id, w.query AS watch_query, w.max_price AS watch_max_price, d.title, d.price, d.source, d.merchant,
            d.url, d.image_url, d.ai_score, d.ai_summary
     FROM deals d JOIN watches w ON w.id = d.watch_id
     WHERE d.is_notified = 0 AND d.ai_match = 1 AND d.found_at >= ?1
       AND (d.ai_score >= ?2 OR (?3 = 1 AND w.max_price IS NOT NULL AND d.price <= w.max_price))
       AND d.watch_id IN (${placeholders})
       AND NOT EXISTS (SELECT 1 FROM deals n WHERE n.url = d.url AND n.is_notified = 1)
     ORDER BY d.ai_score DESC, d.price ASC`,
  ).bind(since, settings.notify_min_score, settings.notify_below_max_price ? 1 : 0, ...watchIds).all<DigestDeal>();

  // Dieselbe URL aus zwei Suchaufträgen nur einmal aufführen.
  const seen = new Set<string>();
  const deals = results.filter((d) => !seen.has(d.url) && seen.add(d.url)).slice(0, MAX_DEALS_PER_DIGEST);
  if (deals.length === 0) return { sent: 0, skipped: 'nothing_new' };

  try {
    await sendWithResend(env, recipient, buildDigest(deals, dashboardUrl));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[email]', message);
    return { sent: 0, error: message }; // nichts markieren → nächster Lauf versucht es erneut
  }

  const urls = deals.map((d) => d.url);
  await env.DB.prepare(`UPDATE deals SET is_notified = 1 WHERE url IN (${urls.map(() => '?').join(',')})`).bind(...urls).run();
  return { sent: deals.length };
}
