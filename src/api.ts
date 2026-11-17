import type {
  AppSettings, AppStatus, Deal, DealSort, RunSummary, Watch, WatchInput, WatchRun, WatchWithStats,
} from '../shared/types';

const TOKEN_KEY = 'dealscout-password';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function getPassword(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

export function setPassword(password: string): void {
  try {
    if (password) localStorage.setItem(TOKEN_KEY, password);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* privater Modus: dann eben nur für diese Sitzung */ }
  sessionPassword = password;
}

let sessionPassword = getPassword();

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (sessionPassword) headers.set('Authorization', `Bearer ${sessionPassword}`);
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError('Server nicht erreichbar', 0);
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Fehler ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}

export interface DealQuery {
  watchId: number | null;
  sort: DealSort;
  minScore: number;
  source: string;
  includeRejected: boolean;
  limit?: number;
}

export const api = {
  authRequired: () => request<{ required: boolean }>('/auth'),
  status: () => request<AppStatus>('/status'),

  watches: () => request<WatchWithStats[]>('/watches'),
  createWatch: (input: WatchInput) => request<Watch>('/watches', { method: 'POST', body: JSON.stringify(input) }),
  updateWatch: (id: number, input: Partial<WatchInput>) =>
    request<Watch>(`/watches/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteWatch: (id: number) => request<{ ok: true }>(`/watches/${id}`, { method: 'DELETE' }),
  runWatch: (id: number) => request<RunSummary>(`/watches/${id}/run`, { method: 'POST' }),
  runs: (id: number) => request<WatchRun[]>(`/watches/${id}/runs`),

  deals: (q: DealQuery) => {
    const params = new URLSearchParams({ sort: q.sort });
    if (q.watchId !== null) params.set('watch_id', String(q.watchId));
    if (q.minScore > 1) params.set('min_score', String(q.minScore));
    if (q.source) params.set('source', q.source);
    if (q.includeRejected) params.set('include_rejected', '1');
    if (q.limit) params.set('limit', String(q.limit));
    return request<Deal[]>(`/deals?${params}`);
  },

  settings: () => request<AppSettings>('/settings'),
  saveSettings: (settings: Partial<AppSettings>) =>
    request<AppSettings>('/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  testEmail: () => request<{ ok: true; recipient: string }>('/settings/test-email', { method: 'POST' }),
};
