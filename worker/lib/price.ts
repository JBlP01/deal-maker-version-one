// Preis-Parsing für deutsche und englische Schreibweisen ("1.299,00 €", "€ 59.99", "150 € VB").

const NUMBER = /\d{1,3}(?:[.\s'’]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?/;

function normalizeNumber(token: string): number | null {
  let t = token.replace(/[\s'’]/g, '');
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Beide Trenner: der letzte ist das Dezimalzeichen.
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    t = t.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = t.split(sep);
    const last = parts[parts.length - 1];
    // "1.500" / "1,299" / "1.234.567" sind Tausender, "59,99" / "59.9" Dezimalstellen.
    t = parts.length > 2 || last.length === 3 ? parts.join('') : parts.join('.');
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Liest den ersten Zahlenwert aus einem Preis-String. Gibt null zurück, wenn kein Preis > 0 erkennbar ist. */
export function parsePrice(input: string | number | null | undefined): number | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) && input > 0 ? Math.round(input * 100) / 100 : null;
  }
  if (!input) return null;
  const match = input.replace(/ /g, ' ').match(NUMBER);
  if (!match) return null;
  const n = normalizeNumber(match[0]);
  return n !== null && n > 0 ? Math.round(n * 100) / 100 : null;
}

const NUM_SRC = String.raw`\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{3})*(?:[.,]\d{1,2})?`;
const PRICE_IN_TEXT = new RegExp(
  String.raw`(?:€|EUR)\s?(${NUM_SRC})|(${NUM_SRC})\s?(?:€|EUR\b|Euro\b)`,
  'i',
);

/** Sucht in Fließtext (z. B. Suchergebnis-Snippets) nach einem Betrag mit Euro-Kennzeichnung. */
export function extractPriceFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/ /g, ' ').match(PRICE_IN_TEXT);
  if (!m) return null;
  return parsePrice(m[1] ?? m[2]);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(m * 100) / 100;
}

export interface PriceStats {
  count: number;
  min: number | null;
  median: number | null;
  max: number | null;
}

export function priceStats(prices: number[]): PriceStats {
  return {
    count: prices.length,
    min: prices.length ? Math.min(...prices) : null,
    median: median(prices),
    max: prices.length ? Math.max(...prices) : null,
  };
}

export function formatEuro(value: number): string {
  return `${value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}
