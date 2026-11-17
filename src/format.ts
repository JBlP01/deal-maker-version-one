const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const euroShort = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const dateOnly = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' });
const relative = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' });

export const formatEuro = (value: number) => euro.format(value);
export const formatEuroShort = (value: number) => euroShort.format(value);
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => dateOnly.format(new Date(iso));

export function formatRelative(iso: string | null): string {
  if (!iso) return 'noch nie';
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return 'gerade eben';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86_400), 'day');
}

export const SOURCE_LABELS: Record<string, string> = {
  websearch: 'Web-Suche',
  mydealz: 'MyDealz',
  kleinanzeigen: 'Kleinanzeigen',
  geizhals: 'Geizhals',
  idealo: 'Idealo',
};

export const sourceLabel = (id: string) => SOURCE_LABELS[id] ?? id;

export const CONDITION_LABELS = { any: 'Neu & gebraucht', new: 'Nur neu', used: 'Nur gebraucht' } as const;
export const OFFER_CONDITION_LABELS = { new: 'Neu', used: 'Gebraucht', unknown: 'Zustand unbekannt' } as const;

export const AI_LABELS: Record<string, string> = {
  'workers-ai': 'Workers AI',
  gemini: 'Gemini',
  groq: 'Groq',
  heuristic: 'Regelbasiert',
  mixed: 'KI + Regeln',
  none: 'aus',
};

export const SEARCH_LABELS: Record<string, string> = { brave: 'Brave Search', serper: 'Serper.dev', duckduckgo: 'DuckDuckGo' };
