import type { OfferCondition, WatchCondition } from '../../shared/types';

export type { PriceStats } from '../lib/price';

export interface AnalysisWatch {
  query: string;
  max_price: number | null;
  condition: WatchCondition;
  exclude_keywords: string;
}

export interface AnalysisOffer {
  title: string;
  price: number;
  source: string;
  merchant?: string | null;
  condition: OfferCondition;
  referencePrice?: number | null;
  snippet?: string | null;
}

export interface OfferVerdict {
  match: boolean;
  score: number;
  summary: string;
  provider: string;
}

export interface TopDeal {
  title: string;
  price: number;
  source: string;
  merchant?: string | null;
  score: number;
}
