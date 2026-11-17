import * as cheerio from 'cheerio/slim';
import { fetchText } from '../lib/http';
import { parsePrice } from '../lib/price';
import { collapse } from '../lib/text';
import { extractJsonLdProducts } from './jsonld';
import type { RawOffer, SourceAdapter } from './types';

const BASE = 'https://www.idealo.de';

// EXPERIMENTELL: Idealo weist Server-Anfragen in der Regel mit HTTP 403 ab.
// Die Selektoren konnten deshalb nicht gegen die echte Seite verifiziert werden.
export function parseIdealoSearch(html: string): RawOffer[] {
  const $ = cheerio.load(html);
  const offers: RawOffer[] = [];
  $('[data-testid="resultItem"], .sr-resultList__item, .offerList-item').each((_, el) => {
    const node = $(el);
    const link = node.find('a[href*="/preisvergleich/"], a.sr-resultItemLink__button, a').first();
    const title = collapse(
      node.find('[data-testid="productSummary__title"], .sr-productSummary__title, .offerList-item-description-title').first().text(),
    );
    const href = link.attr('href');
    const price = parsePrice(
      node.find('[data-testid="detailedPriceInfo__price"], .sr-detailedPriceInfo__price, .offerList-item-priceMin').first().text(),
    );
    if (!title || !href || price === null) return;
    const img = node.find('img').first();
    offers.push({
      title,
      price,
      url: new URL(href, BASE).toString(),
      imageUrl: img.attr('src') ?? img.attr('data-src') ?? null,
      merchant: 'Preisvergleich',
      condition: 'new',
      snippet: 'Bestpreis laut Idealo-Preisvergleich',
    });
  });
  return offers.length > 0 ? offers : extractJsonLdProducts($, BASE);
}

export const idealo: SourceAdapter = {
  id: 'idealo',
  label: 'Idealo',
  description: 'Preisvergleich idealo.de – blockt Server-Anfragen meist per Bot-Schutz',
  experimental: true,
  supports: ['any', 'new'],
  async search({ query, limit }) {
    const params = new URLSearchParams({ q: query });
    const html = await fetchText(`${BASE}/preisvergleich/MainSearchProductCategory.html?${params}`);
    return parseIdealoSearch(html).slice(0, limit);
  },
};
