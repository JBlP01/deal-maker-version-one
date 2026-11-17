import { describe, expect, it } from 'vitest';
import { heuristicVerdict } from '../worker/ai/heuristic';
import { extractJson, parseAnalysis, parseVerdict } from '../worker/ai/parse';
import { buildAnalysisPrompt } from '../worker/ai/prompt';
import { buildDigest } from '../worker/email/digest';
import { extractPriceFromText, median, parsePrice, priceStats } from '../worker/lib/price';
import { canonicalUrl, decodeEntities, parseExcludeKeywords } from '../worker/lib/text';
import { filterOffers } from '../worker/pipeline';
import { analyzeOffers } from '../worker/ai';
import type { Env } from '../worker/env';

describe('Preis-Parsing', () => {
  it.each([
    ['59,99 €', 59.99],
    ['1.500 € VB', 1500],
    ['1.299,00 €', 1299],
    ['€ 59.99', 59.99],
    ['EUR 1,299.00', 1299],
    ['420 €', 420],
    ['12.345.678', 12345678],
    [17.09, 17.09],
    ['VB', null],
    ['Zu verschenken', null],
    ['0 €', null],
    [null, null],
  ])('parsePrice(%j) → %j', (input, expected) => {
    expect(parsePrice(input)).toBe(expected);
  });

  it('findet Preise nur mit Euro-Kennzeichnung im Fließtext', () => {
    expect(extractPriceFromText('Modell 2024 jetzt für 109,90 € bestellen')).toBe(109.9);
    expect(extractPriceFromText('Preis: EUR 1.089,00')).toBe(1089);
    expect(extractPriceFromText('ab 420 Euro')).toBe(420);
    expect(extractPriceFromText('12 Modelle im Test 2024')).toBeNull();
  });

  it('berechnet den Median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('Text-Helfer', () => {
  it('parst Ausschlusswörter in verschiedenen Schreibweisen', () => {
    expect(parseExcludeKeywords('-defekt, -Karton')).toEqual(['defekt', 'karton']);
    expect(parseExcludeKeywords('-defekt -karton')).toEqual(['defekt', 'karton']);
    expect(parseExcludeKeywords('ohne funktion; Bastler')).toEqual(['ohne funktion', 'bastler']);
    expect(parseExcludeKeywords('')).toEqual([]);
  });

  it('entfernt Tracking-Parameter und lehnt Nicht-HTTP-Links ab', () => {
    expect(canonicalUrl('https://shop.example/p?id=5&utm_source=x&fbclid=y#top')).toBe('https://shop.example/p?id=5');
    expect(canonicalUrl('javascript:alert(1)')).toBeNull();
  });

  it('dekodiert HTML-Entities', () => {
    expect(decodeEntities('&quot;A&amp;B&quot; &#039;x&#x27; &euro;')).toBe('"A&B" \'x\' €');
  });
});

describe('Vorfilter', () => {
  const watch = { max_price: 100, condition: 'new' as const, exclude_keywords: 'defekt,hülle' };
  const offer = (title: string, price: number | null, extra: object = {}) => ({
    title, price, url: `https://shop.example/${encodeURIComponent(title)}`, source: 'websearch', ...extra,
  });

  it('wendet Maximalpreis, Zustand, Ausschlusswörter und Dubletten-Erkennung an', () => {
    const kept = filterOffers(watch, [
      offer('Kopfhörer A', 80),
      offer('Kopfhörer B', 120),
      offer('Kopfhörer C DEFEKT', 20),
      offer('Huelle für Kopfhörer', 10),
      offer('Kopfhörer D', 50, { condition: 'used' }),
      offer('Kopfhörer E', null),
      { ...offer('Kopfhörer A', 80), url: 'https://shop.example/Kopfh%C3%B6rer%20A?utm_campaign=x' },
    ]);
    expect(kept.map((o) => o.title)).toEqual(['Kopfhörer A']);
  });

  it('berechnet Vergleichswerte', () => {
    expect(priceStats([10, 30, 20])).toEqual({ count: 3, min: 10, median: 20, max: 30 });
    expect(priceStats([])).toEqual({ count: 0, min: null, median: null, max: null });
  });
});

describe('KI-Antworten', () => {
  it('extrahiert JSON aus Markdown-Zäunen und Fließtext', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Hier ist das Ergebnis: {"a":1} Viel Erfolg!')).toEqual({ a: 1 });
    expect(extractJson({ a: 1 })).toEqual({ a: 1 });
    expect(extractJson('kein json')).toBeNull();
  });

  it('validiert Bewertungen, begrenzt den Score und verwirft Unbrauchbares', () => {
    const parsed = parseAnalysis(
      '{"items":[{"id":1,"match":true,"score":14,"summary":"Gut. Sehr gut."},{"id":2,"match":false,"score":9,"summary":"Zubehör. Kein Treffer."},{"id":3,"match":true,"score":"x","summary":"?"},{"id":9,"match":true,"score":5,"summary":"außerhalb"}]}',
      3,
    );
    expect(parsed.get(0)).toEqual({ match: true, score: 10, summary: 'Gut. Sehr gut.' });
    expect(parsed.get(1)).toEqual({ match: false, score: 3, summary: 'Zubehör. Kein Treffer.' });
    expect(parsed.has(2)).toBe(false);
    expect(parsed.size).toBe(2);
  });

  it('liest das Gesamt-Fazit', () => {
    expect(parseVerdict('{"verdict":"Die beste Wahl ist das Angebot bei Shop A für 99 €."}')).toContain('Shop A');
    expect(parseVerdict('{"verdict":""}')).toBeNull();
  });

  it('baut einen Prompt mit Vergleichspreisen und nummerierten Angeboten', () => {
    const prompt = buildAnalysisPrompt(
      { query: 'Rennrad', max_price: 500, condition: 'used', exclude_keywords: 'defekt' },
      [{ title: 'Rennrad Cube', price: 450, source: 'kleinanzeigen', condition: 'used' }],
      { count: 3, min: 300, median: 450, max: 900 },
    );
    expect(prompt.user).toContain('[1] Rennrad Cube | Preis: 450,00 €');
    expect(prompt.user).toContain('Median 450,00 €');
    expect(prompt.user).toContain('Maximalpreis: 500,00 €');
  });
});

describe('Heuristik (Fallback ohne KI)', () => {
  const watch = { query: 'Sony WH-1000XM5 Kopfhörer', max_price: null, condition: 'any' as const, exclude_keywords: '' };
  const stats = { count: 6, min: 15, median: 280, max: 350 };
  const offer = (title: string, price: number) => ({ title, price, source: 'websearch', condition: 'unknown' as const });

  it('bewertet günstige Angebote höher als teure', () => {
    const cheap = heuristicVerdict(watch, offer('Sony WH-1000XM5 Kopfhörer schwarz', 210), stats);
    const pricey = heuristicVerdict(watch, offer('Sony WH-1000XM5 Kopfhörer silber', 340), stats);
    expect(cheap.match).toBe(true);
    expect(cheap.score).toBeGreaterThan(pricey.score);
    expect(cheap.summary).toMatch(/25 % unter dem Median der passenden Treffer/);
  });

  it('sortiert Zubehör, Gesuche, Defektes und Unrealistisches aus', () => {
    expect(heuristicVerdict(watch, offer('Ohrpolster für Sony WH-1000XM5', 15), stats).match).toBe(false);
    expect(heuristicVerdict(watch, offer('Suche Sony WH-1000XM5', 150), stats).match).toBe(false);
    expect(heuristicVerdict(watch, offer('Sony WH-1000XM5 defekt', 60), stats).match).toBe(false);
    expect(heuristicVerdict(watch, offer('Sony WH-1000XM5 Kopfhörer', 20), stats).match).toBe(false);
    expect(heuristicVerdict(watch, offer('Ohrpolster für Sony WH-1000XM5', 15), stats).score).toBeLessThanOrEqual(3);
  });
});

describe('analyzeOffers ohne KI', () => {
  const watch = { query: 'Rennrad', max_price: 600, condition: 'used' as const, exclude_keywords: '' };
  const offer = (title: string, price: number) => ({ title, price, source: 'Kleinanzeigen', condition: 'used' as const });
  const env = { AI_PROVIDER: 'none' } as Env;

  it('lässt aussortiertes Zubehör nicht in den Vergleichspreis einfließen', async () => {
    const verdicts = await analyzeOffers(env, watch, [
      offer('Rennrad Sattel', 20),
      offer('Rennrad Reifen', 25),
      offer('Fahrradcomputer', 12),
      offer('Rennrad Giant TCR', 320),
      offer('Rennrad Cube Attain', 400),
      offer('Rennräder Bianchi', 480),
    ]);
    expect(verdicts.map((v) => v.match)).toEqual([false, false, false, true, true, true]);
    // Median der passenden Treffer = 400 € → 320 € ist ein guter, 480 € ein mäßiger Preis
    expect(verdicts[3].score).toBeGreaterThan(verdicts[4].score);
    expect(verdicts[4].score).toBeGreaterThan(verdicts[5].score);
    expect(verdicts[3].summary).toContain('Kleinanzeigen');
    expect(verdicts.every((v) => v.provider === 'heuristic')).toBe(true);
  });

  it('bleibt bei zu wenigen Vergleichspreisen neutral', async () => {
    const [verdict] = await analyzeOffers(env, { ...watch, max_price: null }, [offer('Rennrad Giant TCR', 320)]);
    expect(verdict).toMatchObject({ match: true, score: 5 });
  });

  it('nutzt die KI-Antwort und fällt für fehlende Einträge auf die Heuristik zurück', async () => {
    const ai = {
      run: async () => ({ response: { items: [{ id: 1, match: true, score: 9, summary: 'Sehr günstig. Klare Empfehlung.' }] } }),
    };
    const verdicts = await analyzeOffers({ AI_PROVIDER: 'workers-ai', AI: ai } as unknown as Env, watch, [
      offer('Rennrad Giant TCR', 320),
      offer('Rennrad Cube Attain', 400),
    ]);
    expect(verdicts[0]).toEqual({ match: true, score: 9, summary: 'Sehr günstig. Klare Empfehlung.', provider: 'workers-ai' });
    expect(verdicts[1].provider).toBe('heuristic');
  });
});

describe('E-Mail-Digest', () => {
  const deal = {
    id: 1, watch_query: 'Tastatur <b>', watch_max_price: 100, title: 'Keychron <script>alert(1)</script>', price: 89.9,
    source: 'mydealz', merchant: 'Galaxus', url: 'https://www.mydealz.de/deals/x-1?a=1&b=2', image_url: 'javascript:alert(1)',
    ai_score: 9, ai_summary: 'Guter Preis. "Klare" Empfehlung.',
  };

  it('escaped alle dynamischen Inhalte und lässt nur http(s)-Links zu', () => {
    const { html, subject, text } = buildDigest([deal], 'https://dealscout.example');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('Keychron &lt;script&gt;');
    expect(html).toContain('href="https://www.mydealz.de/deals/x-1?a=1&amp;b=2"');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('Deal-Score 9/10');
    expect(html).toContain('unter Wunschpreis');
    expect(subject).toContain('89,90 €');
    expect(text).toContain('https://www.mydealz.de/deals/x-1?a=1&b=2');
  });
});
