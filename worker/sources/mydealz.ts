import type { OfferCondition } from '../../shared/types';
import { fetchText } from '../lib/http';
import { decodeEntities, fold } from '../lib/text';
import type { RawOffer, SourceAdapter } from './types';

// MyDealz bettet jede Trefferkarte als JSON in ein data-vue3-Attribut ein.
// Das ist stabiler als CSS-Klassen und braucht keinen DOM-Parser.
interface MydealzThread {
  threadId: string;
  titleSlug: string;
  title: string;
  type?: string;
  isExpired?: boolean;
  isGone?: boolean;
  price?: number | null;
  nextBestPrice?: number | null;
  temperature?: number | null;
  merchant?: { merchantName?: string } | null;
  mainImage?: { path?: string; name?: string } | null;
  shipping?: { isFree?: boolean | null; price?: number | null } | null;
}

const THREAD_ATTR = /data-vue3='(\{"name":"ThreadMainListItemNormalizer"[^']*)'/g;
const USED_HINT = /\b(gebraucht|refurbished|generalueberholt|b-ware|wie neu|warehouse|retoure)\b/;

export function parseMydealzSearch(html: string): RawOffer[] {
  const offers: RawOffer[] = [];
  for (const match of html.matchAll(THREAD_ATTR)) {
    let thread: MydealzThread | undefined;
    try {
      thread = (JSON.parse(decodeEntities(match[1])) as { props?: { thread?: MydealzThread } }).props?.thread;
    } catch {
      continue; // einzelne kaputte Karte überspringen
    }
    if (!thread?.title || !thread.threadId || !thread.titleSlug) continue;
    if (thread.isExpired || thread.isGone) continue;
    if (thread.type && thread.type !== 'Deal') continue;
    if (typeof thread.price !== 'number' || thread.price <= 0) continue;

    const image = thread.mainImage;
    const condition: OfferCondition = USED_HINT.test(fold(thread.title)) ? 'used' : 'new';
    const notes: string[] = [];
    if (typeof thread.temperature === 'number') notes.push(`Community-Wertung ${Math.round(thread.temperature)}°`);
    if (thread.shipping?.isFree) notes.push('versandkostenfrei');
    else if (thread.shipping?.price) notes.push(`zzgl. ${thread.shipping.price} € Versand`);

    offers.push({
      title: thread.title,
      price: thread.price,
      url: `https://www.mydealz.de/deals/${thread.titleSlug}-${thread.threadId}`,
      imageUrl:
        image?.path && image.name
          ? `https://static.mydealz.de/${image.path}/${image.name}/re/300x300/qt/60/${image.name}.jpg`
          : null,
      merchant: thread.merchant?.merchantName ?? null,
      condition,
      referencePrice: thread.nextBestPrice && thread.nextBestPrice > thread.price ? thread.nextBestPrice : null,
      snippet: notes.join(', ') || null,
    });
  }
  return offers;
}

export const mydealz: SourceAdapter = {
  id: 'mydealz',
  label: 'MyDealz',
  description: 'Community-Deals von mydealz.de (Suche)',
  supports: ['any', 'new'],
  async search({ query, limit }) {
    const html = await fetchText(`https://www.mydealz.de/search?q=${encodeURIComponent(query)}`);
    return parseMydealzSearch(html).slice(0, limit);
  },
};
