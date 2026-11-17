import * as cheerio from 'cheerio/slim';
import { fetchText } from '../lib/http';
import { parsePrice } from '../lib/price';
import { collapse, truncate } from '../lib/text';
import type { RawOffer, SourceAdapter } from './types';

const BASE = 'https://www.kleinanzeigen.de';
const ARTICLE = /<article\b[^>]*\bdata-adid=[\s\S]*?<\/article>/g;
const WANTED = /^\s*(suche|gesucht|gesuch|ankauf|kaufe)\b/i;

// Die Ergebnisseite ist ~800 KB groß. Statt das ganze Dokument zu parsen, werden nur die
// <article>-Blöcke ausgeschnitten (ohne Inline-SVGs) – das spart CPU-Zeit im Worker.
export function parseKleinanzeigenSearch(html: string, limit = 25): RawOffer[] {
  const offers: RawOffer[] = [];
  for (const [block] of html.matchAll(ARTICLE)) {
    if (offers.length >= limit) break;
    const $ = cheerio.load(block.replace(/<svg[\s\S]*?<\/svg>/g, ''));
    const article = $('article').first();

    const titleLink = article.find('h3 a, h2 a, a.ellipsis').first();
    const title = collapse(titleLink.text());
    const href = article.attr('data-href') ?? titleLink.attr('href');
    if (!title || !href || WANTED.test(title)) continue;

    // Preis: neues Markup = <p> mit "€", altes Markup = eigene Preis-Klasse.
    let priceText = collapse(article.find('.aditem-main--middle--price-shipping--price').first().text());
    if (!priceText) {
      article.find('p').each((_, el) => {
        const text = collapse($(el).text());
        if (!priceText && text.length <= 24 && /\d\s?€/.test(text)) priceText = text;
      });
    }
    const price = parsePrice(priceText);
    if (price === null) continue; // "VB" ohne Betrag, "Zu verschenken" o. Ä.

    const description = collapse(article.find('p').first().text());
    const img = article.find('img').first();
    offers.push({
      title,
      price,
      url: new URL(href, BASE).toString(),
      imageUrl: img.attr('src') ?? img.attr('data-imgsrc') ?? null,
      merchant: null,
      condition: 'used',
      snippet:
        [/\bVB\b/.test(priceText) ? 'Verhandlungsbasis' : '', description !== priceText ? truncate(description, 160) : '']
          .filter(Boolean)
          .join(' · ') || null,
    });
  }
  return offers;
}

function slugify(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

export function kleinanzeigenUrl(query: string, maxPrice: number | null): string {
  const slug = encodeURIComponent(slugify(query));
  return maxPrice ? `${BASE}/s-preis::${Math.floor(maxPrice)}/${slug}/k0` : `${BASE}/s-${slug}/k0`;
}

export const kleinanzeigen: SourceAdapter = {
  id: 'kleinanzeigen',
  label: 'Kleinanzeigen',
  description: 'Private Angebote von kleinanzeigen.de (überwiegend gebraucht)',
  supports: ['any', 'used'],
  async search({ query, maxPrice, limit }) {
    const html = await fetchText(kleinanzeigenUrl(query, maxPrice));
    return parseKleinanzeigenSearch(html, limit);
  },
};
