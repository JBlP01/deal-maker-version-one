import type { CheerioAPI } from 'cheerio/slim';
import { parsePrice } from '../lib/price';
import { collapse } from '../lib/text';
import type { RawOffer } from './types';

type Json = Record<string, unknown>;

function firstString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return firstString(value[0]);
  if (value && typeof value === 'object') return firstString((value as Json).url ?? (value as Json).contentUrl);
  return null;
}

function offerPrice(offers: unknown): number | null {
  const offer = (Array.isArray(offers) ? offers[0] : offers) as Json | undefined;
  if (!offer) return null;
  const raw = offer.lowPrice ?? offer.price ?? (offer.priceSpecification as Json | undefined)?.price;
  return typeof raw === 'number' ? parsePrice(raw) : typeof raw === 'string' ? parsePrice(Number(raw) || raw) : null;
}

function collectProducts(node: unknown, out: Json[], depth = 0): void {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) {
    for (const child of node) collectProducts(child, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  const obj = node as Json;
  const type = obj['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes('Product')) out.push(obj);
  collectProducts(obj['@graph'], out, depth + 1);
  collectProducts(obj.itemListElement, out, depth + 1);
  collectProducts(obj.item, out, depth + 1);
}

/** Liest schema.org-Produkte (JSON-LD) aus einer Seite – der robusteste gemeinsame Nenner vieler Shops. */
export function extractJsonLdProducts($: CheerioAPI, baseUrl: string): RawOffer[] {
  const products: Json[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      collectProducts(JSON.parse($(el).text()), products);
    } catch {
      /* ungültiges JSON-LD ignorieren */
    }
  });

  const offers: RawOffer[] = [];
  for (const product of products) {
    const title = collapse(firstString(product.name) ?? '');
    const href = firstString(product.url) ?? firstString((product.offers as Json | undefined)?.url);
    const price = offerPrice(product.offers);
    if (!title || !href || price === null) continue;
    let url: string;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    offers.push({ title, price, url, imageUrl: firstString(product.image), condition: 'new' });
  }
  return offers;
}
