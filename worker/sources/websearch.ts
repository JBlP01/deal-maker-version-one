import * as cheerio from 'cheerio/slim';
import type { Env } from '../env';
import { fetchJson, fetchText, SourceError } from '../lib/http';
import { extractPriceFromText, parsePrice } from '../lib/price';
import { collapse, hostnameOf, truncate } from '../lib/text';
import type { RawOffer, SearchRequest, SourceAdapter } from './types';

export type SearchProvider = 'brave' | 'serper' | 'duckduckgo';

/** "auto": Brave, sobald ein SEARCH_API_KEY gesetzt ist – sonst DuckDuckGo (ohne Key). */
export function resolveSearchProvider(env: Env): SearchProvider {
  const wanted = (env.SEARCH_PROVIDER ?? 'auto').toLowerCase();
  if (wanted === 'duckduckgo') return 'duckduckgo';
  if (!env.SEARCH_API_KEY) return 'duckduckgo';
  return wanted === 'serper' ? 'serper' : 'brave';
}

// Seiten, die für dieselbe Anfrage schon ein eigener Adapter abdeckt oder die nie Angebote sind.
const SKIP_HOSTS = /(^|\.)(mydealz\.de|kleinanzeigen\.de|youtube\.com|wikipedia\.org|reddit\.com|facebook\.com|instagram\.com|pinterest\.[a-z]+)$/;

function shoppingQuery(req: SearchRequest): string {
  const hint = req.condition === 'used' ? 'gebraucht kaufen' : 'kaufen Preis';
  return `${req.query} ${hint}`;
}

/** Web-Treffer ohne erkennbaren Preis sind kein vergleichbares Angebot und werden verworfen. */
function fromWebResult(title: string, url: string, snippet: string, imageUrl?: string | null): RawOffer | null {
  const host = hostnameOf(url);
  if (!host || SKIP_HOSTS.test(host)) return null;
  const price = extractPriceFromText(title) ?? extractPriceFromText(snippet);
  if (price === null) return null;
  return {
    title: collapse(title),
    price,
    url,
    imageUrl: imageUrl ?? null,
    merchant: host,
    condition: 'unknown',
    snippet: truncate(collapse(snippet), 200) || null,
  };
}

// --- Brave Search API --------------------------------------------------------

interface BraveResponse {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
      extra_snippets?: string[];
      thumbnail?: { src?: string };
    }>;
  };
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '');

export function parseBrave(data: BraveResponse): RawOffer[] {
  const offers: RawOffer[] = [];
  for (const r of data.web?.results ?? []) {
    if (!r.title || !r.url) continue;
    const snippet = stripTags([r.description, ...(r.extra_snippets ?? [])].filter(Boolean).join(' '));
    const offer = fromWebResult(stripTags(r.title), r.url, snippet, r.thumbnail?.src);
    if (offer) offers.push(offer);
  }
  return offers;
}

async function searchBrave(req: SearchRequest): Promise<RawOffer[]> {
  const params = new URLSearchParams({
    q: shoppingQuery(req),
    country: 'DE',
    search_lang: 'de',
    count: '20',
    extra_snippets: 'true',
  });
  const data = await fetchJson<BraveResponse>(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: { 'X-Subscription-Token': req.env.SEARCH_API_KEY ?? '' },
    minIntervalMs: 1_100, // Free Tier: 1 Anfrage pro Sekunde
  });
  return parseBrave(data);
}

// --- Serper.dev (Google Shopping) --------------------------------------------

interface SerperResponse {
  shopping?: Array<{
    title?: string;
    source?: string;
    link?: string;
    price?: string;
    imageUrl?: string;
    delivery?: string;
  }>;
}

export function parseSerper(data: SerperResponse): RawOffer[] {
  const offers: RawOffer[] = [];
  for (const r of data.shopping ?? []) {
    const price = parsePrice(r.price);
    if (!r.title || !r.link || price === null) continue;
    offers.push({
      title: collapse(r.title),
      price,
      url: r.link,
      imageUrl: r.imageUrl?.startsWith('http') ? r.imageUrl : null,
      merchant: r.source ?? hostnameOf(r.link),
      condition: /gebraucht|refurbished|generalüberholt/i.test(r.title) ? 'used' : 'unknown',
      snippet: r.delivery ?? null,
    });
  }
  return offers;
}

async function searchSerper(req: SearchRequest): Promise<RawOffer[]> {
  const data = await fetchJson<SerperResponse>('https://google.serper.dev/shopping', {
    method: 'POST',
    headers: { 'X-API-KEY': req.env.SEARCH_API_KEY ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: req.query, gl: 'de', hl: 'de', num: 20 }),
  });
  return parseSerper(data);
}

// --- DuckDuckGo HTML (ohne API-Key) ------------------------------------------

/** DDG verlinkt über /l/?uddg=<Ziel>; das eigentliche Ziel wird herausgelöst. */
function unwrapDuckDuckGoLink(href: string): string | null {
  try {
    const url = new URL(href, 'https://duckduckgo.com');
    const target = url.searchParams.get('uddg');
    if (target) return target;
    return url.hostname.endsWith('duckduckgo.com') ? null : url.toString();
  } catch {
    return null;
  }
}

export function parseDuckDuckGo(html: string): RawOffer[] {
  const $ = cheerio.load(html);
  const offers: RawOffer[] = [];
  $('.result').each((_, el) => {
    const node = $(el);
    if (node.hasClass('result--ad')) return;
    const link = node.find('a.result__a').first();
    const url = unwrapDuckDuckGoLink(link.attr('href') ?? '');
    if (!url) return;
    const offer = fromWebResult(link.text(), url, node.find('.result__snippet').first().text());
    if (offer) offers.push(offer);
  });
  return offers;
}

async function searchDuckDuckGo(req: SearchRequest): Promise<RawOffer[]> {
  const params = new URLSearchParams({ q: shoppingQuery(req), kl: 'de-de' });
  const html = await fetchText(`https://html.duckduckgo.com/html/?${params}`);
  if (html.includes('anomaly-modal')) throw new SourceError('DuckDuckGo verlangt eine Bot-Prüfung', 200, true);
  return parseDuckDuckGo(html);
}

export const websearch: SourceAdapter = {
  id: 'websearch',
  label: 'Web-Suche',
  description: 'Brave Search / Serper.dev (mit SEARCH_API_KEY) oder DuckDuckGo ohne Key',
  async search(req) {
    const provider = resolveSearchProvider(req.env);
    const offers =
      provider === 'brave' ? await searchBrave(req) : provider === 'serper' ? await searchSerper(req) : await searchDuckDuckGo(req);
    return offers.slice(0, req.limit);
  },
};
