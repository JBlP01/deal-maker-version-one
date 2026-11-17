// Kleine Text-Helfer ohne DOM-Abhängigkeit.

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return NAMED[code] ?? whole;
  });
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function collapse(input: string | null | undefined): string {
  return (input ?? '').replace(/\s+/g, ' ').trim();
}

export function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, max - 1).trimEnd()}…`;
}

/** Kleinschreibung + Umlaute/Akzente vereinheitlichen, für Wortvergleiche. */
export function fold(input: string): string {
  return input
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

/** "-defekt, -Karton bastler" → ["defekt", "karton", "bastler"] */
export function parseExcludeKeywords(raw: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const part of (raw ?? '').split(/[,;\n]+|\s+(?=-)/)) {
    const word = part.trim().replace(/^-+/, '').trim().toLowerCase();
    if (word) out.add(word);
  }
  return [...out];
}

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|msclkid|mc_[a-z]+|ref|ref_|tag|srsltid|_gl)$/i;

/** Entfernt Tracking-Parameter und Fragmente, damit dieselbe Seite dieselbe URL ergibt. */
export function canonicalUrl(raw: string, base?: string): string | null {
  try {
    const url = new URL(raw, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
