import type { OfferCondition, WatchCondition } from '../../shared/types';
import type { Env } from '../env';

/** Ein Rohtreffer, wie ihn ein Adapter liefert (noch ungefiltert und unbewertet). */
export interface RawOffer {
  title: string;
  price: number | null;
  url: string;
  imageUrl?: string | null;
  merchant?: string | null;
  condition?: OfferCondition;
  /** Vergleichs-/Streichpreis laut Quelle */
  referencePrice?: number | null;
  /** Kurzbeschreibung als Kontext für die KI */
  snippet?: string | null;
}

export interface SearchRequest {
  query: string;
  maxPrice: number | null;
  condition: WatchCondition;
  limit: number;
  env: Env;
}

/**
 * Ein Such-Adapter. Neue Quelle hinzufügen = diese Schnittstelle implementieren
 * und in worker/sources/index.ts registrieren.
 */
export interface SourceAdapter {
  id: string;
  label: string;
  description: string;
  /** true = Parser konnte nicht gegen die echte Seite geprüft werden / Quelle blockt meist */
  experimental?: boolean;
  /** Für welche Wunsch-Zustände die Quelle sinnvoll ist (fehlt = alle) */
  supports?: WatchCondition[];
  search(request: SearchRequest): Promise<RawOffer[]>;
}
