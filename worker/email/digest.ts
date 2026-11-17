import { formatEuro } from '../lib/price';
import { escapeHtml } from '../lib/text';

export interface DigestDeal {
  id: number;
  watch_query: string;
  watch_max_price: number | null;
  title: string;
  price: number;
  source: string;
  merchant: string | null;
  url: string;
  image_url: string | null;
  ai_score: number | null;
  ai_summary: string | null;
}

export interface DigestEmail {
  subject: string;
  html: string;
  text: string;
}

const SOURCE_LABELS: Record<string, string> = {
  websearch: 'Web-Suche', mydealz: 'MyDealz', kleinanzeigen: 'Kleinanzeigen', geizhals: 'Geizhals', idealo: 'Idealo',
};

function scoreColor(score: number): string {
  return score >= 8 ? '#0ca30c' : score >= 5 ? '#c98500' : '#d03b3b';
}

function sourceLine(deal: DigestDeal): string {
  const label = SOURCE_LABELS[deal.source] ?? deal.source;
  return deal.merchant && deal.merchant !== label ? `${label} · ${deal.merchant}` : label;
}

/** Nur http(s)-Links landen in href/src – alles andere wird verworfen. */
function safeUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? escapeHtml(url) : null;
}

function dealRow(deal: DigestDeal): string {
  const href = safeUrl(deal.url) ?? '#';
  const image = safeUrl(deal.image_url);
  const score = deal.ai_score ?? 0;
  const underWish = deal.watch_max_price !== null && deal.price <= deal.watch_max_price;
  return `
  <tr>
    <td style="padding:16px 0;border-top:1px solid #e5e7eb;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        ${image ? `<td width="96" valign="top" style="padding-right:16px;"><img src="${image}" width="96" height="96" alt="" style="display:block;border-radius:8px;object-fit:cover;background:#f3f4f6;"></td>` : ''}
        <td valign="top" style="font-family:Arial,Helvetica,sans-serif;">
          <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">${escapeHtml(deal.watch_query)} · ${escapeHtml(sourceLine(deal))}</div>
          <a href="${href}" style="font-size:16px;line-height:22px;font-weight:bold;color:#111827;text-decoration:none;">${escapeHtml(deal.title)}</a>
          <div style="margin:8px 0;">
            <span style="font-size:20px;font-weight:bold;color:#111827;">${escapeHtml(formatEuro(deal.price))}</span>
            <span style="display:inline-block;margin-left:10px;padding:3px 10px;border-radius:999px;background:${scoreColor(score)};color:#ffffff;font-size:13px;font-weight:bold;">Deal-Score ${score}/10</span>
            ${underWish ? `<span style="display:inline-block;margin-left:6px;padding:3px 10px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:13px;">unter Wunschpreis (${escapeHtml(formatEuro(deal.watch_max_price!))})</span>` : ''}
          </div>
          ${deal.ai_summary ? `<div style="font-size:14px;line-height:20px;color:#374151;">${escapeHtml(deal.ai_summary)}</div>` : ''}
          <div style="margin-top:10px;"><a href="${href}" style="font-size:14px;color:#2563eb;font-weight:bold;text-decoration:none;">Zum Angebot &rarr;</a></div>
        </td>
      </tr></table>
    </td>
  </tr>`;
}

export function buildDigest(deals: DigestDeal[], dashboardUrl?: string): DigestEmail {
  const best = deals[0];
  const subject =
    deals.length === 1
      ? `Top-Deal: ${best.title.slice(0, 70)} für ${formatEuro(best.price)}`
      : `${deals.length} neue Top-Deals – u. a. ${best.title.slice(0, 50)} für ${formatEuro(best.price)}`;
  const dashboard = safeUrl(dashboardUrl ?? null);

  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
    <tr><td style="background:#0f172a;padding:20px 24px;font-family:Arial,Helvetica,sans-serif;">
      <div style="font-size:20px;font-weight:bold;color:#ffffff;">DealScout AI</div>
      <div style="font-size:14px;color:#cbd5e1;margin-top:4px;">${deals.length === 1 ? 'Ein neuer Top-Deal wurde gefunden' : `${deals.length} neue Top-Deals wurden gefunden`}</div>
    </td></tr>
    <tr><td style="padding:8px 24px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${deals.map(dealRow).join('')}</table>
    </td></tr>
    <tr><td style="padding:16px 24px;background:#f9fafb;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#6b7280;">
      Du erhältst diese E-Mail, weil ein Angebot deinen Schwellenwert erreicht hat oder unter deinem Wunschpreis liegt.
      Jedes Angebot wird nur einmal gemeldet.${dashboard ? ` <a href="${dashboard}" style="color:#2563eb;">Dashboard öffnen</a>` : ''}
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const text = [
    `DealScout AI – ${deals.length} neue${deals.length === 1 ? 'r' : ''} Top-Deal${deals.length === 1 ? '' : 's'}`,
    '',
    ...deals.flatMap((d) => [
      `${d.title}`,
      `${formatEuro(d.price)} · Deal-Score ${d.ai_score ?? '–'}/10 · ${sourceLine(d)} · Suche: ${d.watch_query}`,
      ...(d.ai_summary ? [d.ai_summary] : []),
      d.url,
      '',
    ]),
  ].join('\n');

  return { subject, html, text };
}
