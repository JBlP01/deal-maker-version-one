// Typen, die Worker (API) und Frontend gemeinsam nutzen.

export type WatchCondition = 'any' | 'new' | 'used';
export type OfferCondition = 'new' | 'used' | 'unknown';

export interface Watch {
  id: number;
  query: string;
  max_price: number | null;
  condition: WatchCondition;
  exclude_keywords: string;
  is_active: number;
  last_checked_at: string | null;
  ai_verdict: string | null;
  ai_verdict_at: string | null;
  created_at: string;
}

export interface WatchWithStats extends Watch {
  deal_count: number;
  lowest_price: number | null;
  best_score: number | null;
}

export interface WatchInput {
  query: string;
  max_price?: number | null;
  condition?: WatchCondition;
  exclude_keywords?: string;
  is_active?: boolean;
}

export interface Deal {
  id: number;
  watch_id: number;
  watch_query?: string;
  title: string;
  price: number;
  currency: string;
  source: string;
  merchant: string | null;
  url: string;
  image_url: string | null;
  condition: OfferCondition;
  reference_price: number | null;
  ai_match: number | null;
  ai_score: number | null;
  ai_summary: string | null;
  ai_provider: string | null;
  is_notified: number;
  found_at: string;
  last_seen_at: string;
}

export interface SourceRunStatus {
  id: string;
  label: string;
  ok: boolean;
  count: number;
  ms: number;
  skipped?: 'cooldown';
  blocked?: boolean;
  error?: string;
}

export interface WatchRun {
  id: number;
  watch_id: number;
  triggered_by: 'cron' | 'manual';
  started_at: string;
  finished_at: string;
  found_count: number;
  new_count: number;
  match_count: number;
  lowest_price: number | null;
  median_price: number | null;
  ai_provider: string | null;
  sources: SourceRunStatus[];
}

export interface RunSummary {
  watch_id: number;
  found: number;
  new: number;
  matched: number;
  lowest_price: number | null;
  /** null = nichts Neues zu bewerten */
  ai_provider: string | null;
  sources: SourceRunStatus[];
  email: EmailOutcome;
}

export interface EmailOutcome {
  sent: number;
  skipped?: 'not_configured' | 'nothing_new';
  error?: string;
}

export interface SourceInfo {
  id: string;
  label: string;
  description: string;
  experimental: boolean;
  enabled: boolean;
  cooldown_until: string | null;
}

export interface AppSettings {
  notification_email: string;
  notify_min_score: number;
  notify_below_max_price: boolean;
  enabled_sources: string[];
}

export interface AppStatus {
  ai_provider: string;
  ai_ready: boolean;
  search_provider: string;
  email_ready: boolean;
  email_recipient_source: 'settings' | 'env' | 'none';
  sources: SourceInfo[];
  cron: string;
}

export type DealSort = 'score' | 'price' | 'recent';
