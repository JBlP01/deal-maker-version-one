import * as cheerio from 'cheerio/slim';
import { fetchText } from '../lib/http';
import { parsePrice } from '../lib/price';
import { collapse } from '../lib/text';
import { extractJsonLdProducts } from './jsonld';
import type { RawOffer, SourceAdapter } from './types';

const BASE = 'https://geizhals.de';

// EXPERIMENTELL: Geizhals liefert Server-Anfragen in der Regel eine Bot-Check-Seite (HTTP 403).
// Die Selektoren konnten deshalb nicht gegen die echte Seite verifiziert werden.
export function parseGeizhalsSearch(html: string): RawOffer[] {
  const $ = cheerio.load(html);
  const offers: RawOffer[] = [];
  $('article.galleryview__item, article.listview__item, .productlist__product').each((_, el) => {
    const node = $(el);
    const link = node.find('a.galleryview__name-link, a.listview__name-link, .productlist__link').first();
    const title = collapse(link.text());
    const href = link.attr('href');
    const price = parsePrice(node.find('.galleryview__price .price, .listview__price-link .price, .gh_price').first().text());
    if (!title || !href || price === null) return;
    const img = node.find('img').first();
    offers.push({
      title,
      price,
      url: new URL(href, BASE).toString(),
      imageUrl: img.attr('src') ?? img.attr('data-src') ?? null,
      merchant: 'Preisvergleich',
      condition: 'new',
      snippet: 'Bestpreis laut Geizhals-Preisvergleich',
    });
  });
  return offers.length > 0 ? offers : extractJsonLdProducts($, BASE);
}

export const geizhals: SourceAdapter = {
  id: 'geizhals',
  label: 'Geizhals',
  description: 'Preisvergleich geizhals.de – blockt Server-Anfragen meist per Bot-Schutz',
  experimental: true,
  supports: ['any', 'new'],
  async search({ query, maxPrice, limit }) {
    const params = new URLSearchParams({ fs: query });
    if (maxPrice) params.set('bpmax', String(Math.floor(maxPrice)));
    const html = await fetchText(`${BASE}/?${params}`);
    return parseGeizhalsSearch(html).slice(0, limit);
  },
};
