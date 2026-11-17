import { collapse, truncate } from '../lib/text';

/** Holt ein JSON-Objekt aus einer Modellantwort – auch wenn Markdown-Zäune oder Text drumherum stehen. */
export function extractJson(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/```(?:json)?/gi, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface ParsedItem {
  match: boolean;
  score: number;
  summary: string;
}

/**
 * Validiert die Bewertungs-Antwort. Rückgabe: Angebots-Index (0-basiert) → Bewertung.
 * Einträge mit unbrauchbaren Feldern fehlen in der Map und fallen auf die Heuristik zurück.
 */
export function parseAnalysis(raw: unknown, offerCount: number): Map<number, ParsedItem> {
  const out = new Map<number, ParsedItem>();
  const items = extractJson(raw)?.items;
  if (!Array.isArray(items)) return out;
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const id = Number(item.id);
    const score = Number(item.score);
    const summary = typeof item.summary === 'string' ? collapse(item.summary) : '';
    const match = typeof item.match === 'boolean' ? item.match : item.match === 'true' ? true : item.match === 'false' ? false : null;
    if (!Number.isInteger(id) || id < 1 || id > offerCount) continue;
    if (!Number.isFinite(score) || match === null || !summary) continue;
    const clamped = Math.max(1, Math.min(10, Math.round(score)));
    out.set(id - 1, { match, score: match ? clamped : Math.min(clamped, 3), summary: truncate(summary, 400) });
  }
  return out;
}

export function parseVerdict(raw: unknown): string | null {
  const verdict = extractJson(raw)?.verdict;
  return typeof verdict === 'string' && collapse(verdict).length >= 20 ? truncate(collapse(verdict), 700) : null;
}
