import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { kleinanzeigenUrl, parseKleinanzeigenSearch } from '../worker/sources/kleinanzeigen';
import { parseMydealzSearch } from '../worker/sources/mydealz';
import { parseBrave, parseDuckDuckGo, parseSerper, resolveSearchProvider } from '../worker/sources/websearch';
import { looksBlocked } from '../worker/lib/http';
import type { Env } from '../worker/env';

const fixture = (name: string) => readFileSync(`${import.meta.dirname}/fixtures/${name}`, 'utf8');

describe('MyDealz', () => {
  const offers = parseMydealzSearch(fixture('mydealz-search.html'));

  it('liest Titel, Preis, Händler, Link und Bild aus den eingebetteten Karten', () => {
    expect(offers).toHaveLength(8);
    const first = offers[0];
    expect(first.title).toContain('Logitech MK270');
    expect(first.price).toBe(17.09);
    expect(first.merchant).toBe('Amazon');
    expect(first.url).toMatch(/^https:\/\/www\.mydealz\.de\/deals\/logitech-mk270-.+-2873207$/);
    expect(first.imageUrl).toMatch(/^https:\/\/static\.mydealz\.de\/threads\/raw\/.+\.jpg$/);
    expect(first.condition).toBe('new');
  });

  it('übernimmt den Vergleichspreis nur, wenn er über dem Deal-Preis liegt', () => {
    expect(offers[0].referencePrice).toBeNull();
    expect(offers[1].referencePrice).toBe(99.99);
  });

  it('überspringt abgelaufene Deals und Gutscheine', () => {
    expect(offers.some((o) => o.title.includes('Abgelaufener'))).toBe(false);
    expect(offers.some((o) => o.title.startsWith('10% Gutschein'))).toBe(false);
  });
});

describe('Kleinanzeigen', () => {
  const offers = parseKleinanzeigenSearch(fixture('kleinanzeigen-search.html'));

  it('liest Anzeigen mit Preis und überspringt Gesuche, Verschenk-Anzeigen und reine VB-Preise', () => {
    expect(offers.map((o) => o.title)).toEqual([
      'Rennrad Cube Attain RH 56',
      'Carbon Rennrad Shimano 105',
      'Rennrad Reifen Continental 28 Zoll',
    ]);
  });

  it('parst deutsche Preise, Links, Bilder und Verhandlungsbasis', () => {
    expect(offers[0].price).toBe(450);
    expect(offers[0].snippet).toContain('Verhandlungsbasis');
    expect(offers[0].snippet).toContain('Gut erhaltenes Rennrad');
    expect(offers[1].price).toBe(1500);
    expect(offers[0].url).toBe('https://www.kleinanzeigen.de/s-anzeige/rennrad-cube-attain-rh-56/1000000001-217-0000');
    expect(offers[0].imageUrl).toMatch(/^https:\/\/img\.kleinanzeigen\.de\//);
    expect(offers[0].condition).toBe('used');
  });

  it('baut Such-URLs mit und ohne Maximalpreis', () => {
    expect(kleinanzeigenUrl('Noise Cancelling Kopfhörer', null)).toBe(
      'https://www.kleinanzeigen.de/s-noise-cancelling-kopfh%C3%B6rer/k0',
    );
    expect(kleinanzeigenUrl('Rennrad', 150.5)).toBe('https://www.kleinanzeigen.de/s-preis::150/rennrad/k0');
  });
});

describe('Web-Suche', () => {
  it('DuckDuckGo: löst Weiterleitungen auf, verwirft Werbung, preislose Treffer und abgedeckte Quellen', () => {
    const offers = parseDuckDuckGo(fixture('duckduckgo.html'));
    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({
      title: 'Keychron K8 Pro kaufen | Example Shop',
      price: 109.9,
      url: 'https://www.example-shop.de/keychron-k8-pro?utm_source=ddg',
      merchant: 'example-shop.de',
    });
    expect(offers[1].price).toBe(1089);
  });

  it('Brave: nimmt den Preis aus Titel oder Snippets', () => {
    const offers = parseBrave({
      web: {
        results: [
          { title: 'Sony WH-1000XM5', url: 'https://shop.example/xm5', description: 'Jetzt für <strong>279,00 €</strong>', thumbnail: { src: 'https://img.example/x.jpg' } },
          { title: 'Testbericht', url: 'https://magazin.example/test', description: 'Kein Preis' },
          { title: 'Bose QC45', url: 'https://shop.example/qc45', description: 'Top', extra_snippets: ['Preis: € 199.99'] },
        ],
      },
    });
    expect(offers.map((o) => o.price)).toEqual([279, 199.99]);
    expect(offers[0].imageUrl).toBe('https://img.example/x.jpg');
  });

  it('Serper Shopping: parst Preis-Strings', () => {
    const offers = parseSerper({
      shopping: [
        { title: 'Rennrad', source: 'Bike24', link: 'https://example.com/a', price: '1.299,00 €', imageUrl: 'https://img.example/a.jpg' },
        { title: 'Ohne Preis', link: 'https://example.com/b' },
      ],
    });
    expect(offers).toEqual([expect.objectContaining({ price: 1299, merchant: 'Bike24' })]);
  });

  it('wählt den Anbieter anhand von Key und SEARCH_PROVIDER', () => {
    const env = (vars: Partial<Env>) => vars as Env;
    expect(resolveSearchProvider(env({}))).toBe('duckduckgo');
    expect(resolveSearchProvider(env({ SEARCH_PROVIDER: 'auto', SEARCH_API_KEY: 'k' }))).toBe('brave');
    expect(resolveSearchProvider(env({ SEARCH_PROVIDER: 'serper', SEARCH_API_KEY: 'k' }))).toBe('serper');
    expect(resolveSearchProvider(env({ SEARCH_PROVIDER: 'serper' }))).toBe('duckduckgo');
  });
});

describe('Bot-Schutz-Erkennung', () => {
  it('erkennt Challenge-Seiten', () => {
    expect(looksBlocked('<html><head><title>Sichere Verbindung wird überprüft</title>')).toBe(true);
    expect(looksBlocked('<html><head><title>Rennrad kleinanzeigen.de</title>')).toBe(false);
  });
});
