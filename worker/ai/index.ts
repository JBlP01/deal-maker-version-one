import type { Env } from '../env';
import { priceStats } from '../lib/price';
import { heuristicOverallVerdict, heuristicVerdict } from './heuristic';
import { parseAnalysis, parseVerdict } from './parse';
import { buildAnalysisPrompt, buildVerdictPrompt } from './prompt';
import { callModel, isAiReady, resolveAiProvider } from './providers';
import type { AnalysisOffer, AnalysisWatch, OfferVerdict, TopDeal } from './types';

export { isAiReady, resolveAiProvider } from './providers';
export type * from './types';

const BATCH_SIZE = 10;
/** Obergrenze an KI-Aufrufen je Suchlauf (kostenlose Kontingente, Subrequest-Limits). */
const MAX_BATCHES = 4;

/**
 * Bewertet Angebote: Filterung (match), Deal-Score und 2-Satz-Zusammenfassung.
 * Fällt die KI aus oder liefert für einzelne Angebote nichts Brauchbares,
 * übernimmt die regelbasierte Heuristik – der Suchlauf schlägt deshalb nie fehl.
 *
 * @param knownGoodPrices Preise der Treffer dieses Laufs, die schon früher als passend bewertet wurden
 */
export async function analyzeOffers(
  env: Env,
  watch: AnalysisWatch,
  offers: AnalysisOffer[],
  knownGoodPrices: number[] = [],
): Promise<OfferVerdict[]> {
  if (offers.length === 0) return [];

  // Vergleichspreise: erst grob aussortieren (Zubehör, Gesuche, Ausreißer), damit z. B. ein
  // 12-€-Ersatzteil nicht den Median drückt und echte Angebote "teuer" aussehen lässt.
  const allStats = priceStats([...knownGoodPrices, ...offers.map((o) => o.price)]);
  const rough = offers.map((offer) => heuristicVerdict(watch, offer, allStats));
  const stats = priceStats([...knownGoodPrices, ...offers.filter((_, i) => rough[i].match).map((o) => o.price)]);
  const verdicts: OfferVerdict[] = offers.map((offer, i) => (rough[i].match ? heuristicVerdict(watch, offer, stats) : rough[i]));
  if (!isAiReady(env)) return verdicts;

  const provider = resolveAiProvider(env);
  for (let b = 0; b < MAX_BATCHES && b * BATCH_SIZE < offers.length; b++) {
    const offset = b * BATCH_SIZE;
    const batch = offers.slice(offset, offset + BATCH_SIZE);
    try {
      const raw = await callModel(env, buildAnalysisPrompt(watch, batch, stats));
      for (const [index, item] of parseAnalysis(raw, batch.length)) {
        verdicts[offset + index] = { ...item, provider };
      }
    } catch (error) {
      console.warn(`[ai:${provider}] Batch ${b + 1} fehlgeschlagen:`, error instanceof Error ? error.message : error);
      break; // z. B. Kontingent erschöpft – weitere Aufrufe wären zwecklos
    }
  }
  return verdicts;
}

/** Gesamt-Fazit ("Top-Empfehlung der Woche") über die besten Treffer eines Suchauftrags. */
export async function overallVerdict(env: Env, watch: AnalysisWatch, top: TopDeal[]): Promise<string> {
  if (top.length > 0 && isAiReady(env)) {
    try {
      const verdict = parseVerdict(await callModel(env, buildVerdictPrompt(watch, top)));
      if (verdict) return verdict;
    } catch (error) {
      console.warn('[ai] Fazit fehlgeschlagen:', error instanceof Error ? error.message : error);
    }
  }
  return heuristicOverallVerdict(watch, top);
}
