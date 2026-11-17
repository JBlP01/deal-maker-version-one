import { formatEuro } from '../lib/price';
import { fold } from '../lib/text';
import type { AnalysisOffer, AnalysisWatch, OfferVerdict, PriceStats, TopDeal } from './types';

// Regelbasierter Ersatz, wenn keine KI erreichbar ist (kein Key, Kontingent leer, ungültige Antwort).
// Bewusst simpel und nachvollziehbar: Zubehör-Wörter + Preis relativ zum Median.

const ACCESSORY_WORDS = [
  'huelle', 'case', 'schutzfolie', 'panzerglas', 'ersatzteil', 'ersatzteile', 'ersatzpolster', 'ohrpolster',
  'kabel', 'adapter', 'halterung', 'staender', 'tasche', 'cover', 'aufkleber', 'sticker', 'keycaps',
  'tastenkappen', 'handballenauflage', 'ladegeraet', 'netzteil', 'anleitung', 'verpackung', 'leerkarton',
  'schlauch', 'reifen', 'sattel', 'pedale', 'klingel', 'schloss',
];
const DEFECT_WORDS = ['defekt', 'bastler', 'kaputt', 'ersatzteilspender', 'ohne funktion'];
const WANTED = /^\s*(suche|gesucht|gesuch|ankauf|kaufe)\b/i;

function tokens(text: string): string[] {
  return fold(text).split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
}

export function heuristicVerdict(watch: AnalysisWatch, offer: AnalysisOffer, stats: PriceStats): OfferVerdict {
  const title = fold(offer.title);
  const queryTokens = tokens(watch.query);
  const titleTokens = new Set(tokens(offer.title));
  const queryFolded = fold(watch.query);

  // Wortstamm-Vergleich über den Wortanfang, damit "Rennrad" auch "Rennräder" trifft.
  const stem = (t: string) => t.slice(0, Math.max(4, Math.ceil(t.length * 0.7)));
  const overlap = queryTokens.filter((t) => title.includes(t) || [...titleTokens].some((w) => w.startsWith(stem(t)))).length;
  const coverage = queryTokens.length ? overlap / queryTokens.length : 1;
  const accessory = ACCESSORY_WORDS.find((w) => titleTokens.has(w) && !queryFolded.includes(w));
  const defect = DEFECT_WORDS.find((w) => title.includes(w) && !queryFolded.includes(w));
  const suspiciouslyCheap = stats.median !== null && stats.count >= 4 && offer.price < stats.median * 0.15;

  let match = true;
  let reason = '';
  if (WANTED.test(offer.title)) { match = false; reason = 'Das ist ein Gesuch, kein Angebot.'; }
  else if (defect) { match = false; reason = `Der Titel deutet auf defekte Ware hin („${defect}“).`; }
  else if (accessory) { match = false; reason = 'Der Titel deutet auf Zubehör oder ein Ersatzteil hin.'; }
  else if (suspiciouslyCheap) { match = false; reason = 'Der Preis liegt weit unter allen Vergleichsangeboten – vermutlich Zubehör oder unseriös.'; }
  else if (coverage === 0) { match = false; reason = 'Der Titel enthält keinen der Suchbegriffe.'; }

  // Score: 5 = Vergleichspreis. Je 10 % darunter/darüber etwa ±0,6 Punkte.
  // Ohne belastbaren Vergleich (weniger als 3 passende Treffer) bleibt es bei neutralen 5.
  let score = 5;
  const reference =
    offer.referencePrice && offer.referencePrice > offer.price ? offer.referencePrice : stats.count >= 3 ? stats.median : null;
  if (reference && reference > 0) score = 5 + ((reference - offer.price) / reference) * 6;
  if (watch.max_price && offer.price <= watch.max_price * 0.8) score += 1;
  if (coverage < 0.5) score -= 1;
  if (watch.condition === 'new' && offer.condition === 'used') score -= 1;
  score = Math.max(1, Math.min(9, Math.round(score))); // die 10 bleibt der KI vorbehalten
  if (!match) score = Math.min(score, 3);

  let comparison = 'Für einen Preisvergleich gibt es noch zu wenige passende Treffer.';
  if (reference && reference > 0) {
    const diff = Math.round(((offer.price - reference) / reference) * 100);
    const basis = reference === offer.referencePrice ? 'dem Vergleichspreis der Quelle' : 'dem Median der passenden Treffer';
    comparison =
      Math.abs(diff) < 3
        ? `Der Preis entspricht etwa ${basis} (${formatEuro(reference)}).`
        : `Der Preis liegt ${Math.abs(diff)} % ${diff < 0 ? 'unter' : 'über'} ${basis} (${formatEuro(reference)}).`;
  }
  const conditionLabel = offer.condition === 'new' ? 'Neuware' : offer.condition === 'used' ? 'Gebrauchtware' : 'Angebot';
  const first = `${conditionLabel} für ${formatEuro(offer.price)} bei ${offer.merchant || offer.source}.`;

  return { match, score, summary: match ? `${first} ${comparison}` : `${first} ${reason}`, provider: 'heuristic' };
}

export function heuristicOverallVerdict(watch: AnalysisWatch, top: TopDeal[]): string {
  if (top.length === 0) return `Für „${watch.query}“ wurde noch kein passendes Angebot gefunden.`;
  const best = top[0];
  const where = best.merchant || best.source;
  const rest = top.length > 1 ? ` Alternativen beginnen bei ${formatEuro(Math.min(...top.slice(1).map((d) => d.price)))}.` : '';
  return `Top-Empfehlung: „${best.title}“ für ${formatEuro(best.price)} bei ${where} (Deal-Score ${best.score}/10).${rest}`;
}
