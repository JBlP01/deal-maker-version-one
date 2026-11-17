import type { SourceRunStatus, WatchCondition } from '../../shared/types';
import type { Env } from '../env';
import { SourceError } from '../lib/http';
import { geizhals } from './geizhals';
import { idealo } from './idealo';
import { kleinanzeigen } from './kleinanzeigen';
import { mydealz } from './mydealz';
import type { RawOffer, SourceAdapter } from './types';
import { websearch } from './websearch';

/** Registrierung aller Quellen. Reihenfolge = Anzeige-Reihenfolge im Dashboard. */
export const ADAPTERS: SourceAdapter[] = [websearch, mydealz, kleinanzeigen, geizhals, idealo];

export const DEFAULT_ENABLED = ADAPTERS.filter((a) => !a.experimental).map((a) => a.id);

const SOURCE_TIMEOUT_MS = 25_000;
const PER_SOURCE_LIMIT = 15;

export interface SourceOffer extends RawOffer {
  source: string;
}

export interface SearchAllResult {
  offers: SourceOffer[];
  statuses: SourceRunStatus[];
}

export interface SearchAllInput {
  query: string;
  maxPrice: number | null;
  condition: WatchCondition;
  env: Env;
  enabled: string[];
  /** Quellen-ID → ISO-Zeitpunkt, bis zu dem die Quelle pausiert (nach Blockade) */
  cooldowns: Record<string, string>;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SourceError(`Zeitüberschreitung (${label})`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Fragt alle passenden Quellen parallel ab. Jede Quelle ist für sich gekapselt:
 * Fehler, Timeouts und Blockaden landen im Status, der Rest läuft weiter.
 */
export async function searchAllSources(input: SearchAllInput): Promise<SearchAllResult> {
  const now = Date.now();
  const selected = ADAPTERS.filter(
    (a) => input.enabled.includes(a.id) && (!a.supports || a.supports.includes(input.condition)),
  );

  const results = await Promise.all(
    selected.map(async (adapter): Promise<{ status: SourceRunStatus; offers: SourceOffer[] }> => {
      const base = { id: adapter.id, label: adapter.label };
      const cooldown = input.cooldowns[adapter.id];
      if (cooldown && Date.parse(cooldown) > now) {
        return { status: { ...base, ok: false, count: 0, ms: 0, skipped: 'cooldown' }, offers: [] };
      }
      const started = Date.now();
      try {
        const raw = await withTimeout(
          adapter.search({
            query: input.query,
            maxPrice: input.maxPrice,
            condition: input.condition,
            limit: PER_SOURCE_LIMIT,
            env: input.env,
          }),
          SOURCE_TIMEOUT_MS,
          adapter.label,
        );
        const offers = raw.map((offer) => ({ ...offer, source: adapter.id }));
        return { status: { ...base, ok: true, count: offers.length, ms: Date.now() - started }, offers };
      } catch (error) {
        const blocked = error instanceof SourceError && error.blocked;
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[source:${adapter.id}] ${message}`);
        return {
          status: { ...base, ok: false, count: 0, ms: Date.now() - started, blocked, error: message.slice(0, 200) },
          offers: [],
        };
      }
    }),
  );

  return { offers: results.flatMap((r) => r.offers), statuses: results.map((r) => r.status) };
}
