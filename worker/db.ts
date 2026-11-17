import type { AppSettings, Watch } from '../shared/types';
import type { Env } from './env';
import { DEFAULT_ENABLED } from './sources';

export const nowIso = () => new Date().toISOString();

const COOLDOWN_PREFIX = 'cooldown:';

export async function getSettingsMap(env: Env): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((row) => [row.key, row.value]));
}

export function toAppSettings(map: Record<string, string>): AppSettings {
  const minScore = Number(map.notify_min_score);
  return {
    notification_email: map.notification_email ?? '',
    notify_min_score: Number.isInteger(minScore) && minScore >= 1 && minScore <= 10 ? minScore : 8,
    notify_below_max_price: (map.notify_below_max_price ?? '1') === '1',
    enabled_sources: map.enabled_sources !== undefined ? map.enabled_sources.split(',').filter(Boolean) : DEFAULT_ENABLED,
  };
}

export function cooldownsFrom(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    if (key.startsWith(COOLDOWN_PREFIX)) out[key.slice(COOLDOWN_PREFIX.length)] = value;
  }
  return out;
}

export function setSettingStatement(env: Env, key: string, value: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(key, value, nowIso());
}

export function cooldownStatement(env: Env, sourceId: string, until: Date): D1PreparedStatement {
  return setSettingStatement(env, COOLDOWN_PREFIX + sourceId, until.toISOString());
}

export function clearCooldownStatement(env: Env, sourceId: string): D1PreparedStatement {
  return env.DB.prepare('DELETE FROM settings WHERE key = ?1').bind(COOLDOWN_PREFIX + sourceId);
}

export async function getWatch(env: Env, id: number): Promise<Watch | null> {
  return env.DB.prepare('SELECT * FROM watches WHERE id = ?1').bind(id).first<Watch>();
}

/** D1 erlaubt nur begrenzt viele Statements je Batch – große Mengen werden gestückelt. */
export async function batchInChunks(env: Env, statements: D1PreparedStatement[], size = 40): Promise<void> {
  for (let i = 0; i < statements.length; i += size) {
    await env.DB.batch(statements.slice(i, i + size));
  }
}
