// Gekapselter Fetch für Scraper: Timeout, höfliches Rate-Limit je Host, ein Retry,
// und eine einheitliche Fehlerklasse, damit eine blockierte Quelle den Lauf nie abbricht.

export class SourceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** true = Quelle hat uns aktiv abgewiesen (403/429/Bot-Check) → Cooldown sinnvoll */
    readonly blocked = false,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

export interface PoliteFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** zusätzliche Versuche bei 429/5xx/Netzwerkfehlern */
  retries?: number;
  /** Mindestabstand zwischen zwei Requests an denselben Host */
  minIntervalMs?: number;
}

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.6',
};

// Nächster freier Zeitpunkt je Host (gilt innerhalb eines Isolates/Laufs).
const nextSlot = new Map<string, number>();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function throttle(host: string, minIntervalMs: number): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, slot + minIntervalMs);
  if (slot > now) await sleep(slot - now);
}

const BLOCK_MARKERS = [
  'Sichere Verbindung wird überprüft',
  'Nur einen Moment',
  'Just a moment...',
  'cf-challenge',
  'captcha-delivery.com',
  'Access Denied',
  'unusual traffic',
];

/** Erkennt Bot-Schutz-Seiten, die mit Status 200 ausgeliefert werden. */
export function looksBlocked(html: string): boolean {
  const head = html.slice(0, 6000);
  return BLOCK_MARKERS.some((marker) => head.includes(marker));
}

export async function politeFetch(url: string, options: PoliteFetchOptions = {}): Promise<Response> {
  const { timeoutMs = 12_000, retries = 1, minIntervalMs = 1_500 } = options;
  const host = new URL(url).host;
  let lastError: SourceError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(host, minIntervalMs);
    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: { ...BROWSER_HEADERS, ...options.headers },
        body: options.body,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return response;

      const blocked = response.status === 403 || response.status === 429;
      lastError = new SourceError(`HTTP ${response.status} von ${host}`, response.status, blocked);
      await response.body?.cancel();
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable) break;
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1_500 * (attempt + 1), 5_000));
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      lastError = new SourceError(timedOut ? `Zeitüberschreitung bei ${host}` : `Netzwerkfehler bei ${host}: ${String(error)}`);
    }
  }
  throw lastError ?? new SourceError(`Unbekannter Fehler bei ${host}`);
}

/** Lädt HTML/XML als Text und wirft SourceError(blocked), wenn eine Bot-Check-Seite zurückkommt. */
export async function fetchText(url: string, options?: PoliteFetchOptions): Promise<string> {
  const response = await politeFetch(url, options);
  const text = await response.text();
  if (looksBlocked(text)) throw new SourceError(`Bot-Schutz bei ${new URL(url).host}`, response.status, true);
  return text;
}

export async function fetchJson<T>(url: string, options?: PoliteFetchOptions): Promise<T> {
  const response = await politeFetch(url, {
    ...options,
    headers: { Accept: 'application/json', ...options?.headers },
  });
  try {
    return (await response.json()) as T;
  } catch {
    throw new SourceError(`Ungültiges JSON von ${new URL(url).host}`);
  }
}
