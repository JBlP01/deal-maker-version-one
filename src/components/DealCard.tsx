import { BellRing, ExternalLink, ImageOff, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { Deal } from '../../shared/types';
import { AI_LABELS, formatEuro, formatRelative, OFFER_CONDITION_LABELS, sourceLabel } from '../format';
import { ScoreBadge } from './ScoreBadge';
import { Chip } from './ui';

export function DealCard({ deal, showWatch }: { deal: Deal; showWatch: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const rejected = deal.ai_match === 0;
  const saving =
    deal.reference_price && deal.reference_price > deal.price
      ? Math.round((1 - deal.price / deal.reference_price) * 100)
      : null;
  const source = sourceLabel(deal.source);
  const photo = deal.source === 'kleinanzeigen';

  return (
    <article className={`flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition hover:border-muted ${rejected ? 'opacity-60' : ''}`}>
      {/* Produktfotos (meist auf Weiß) vollständig zeigen, Kleinanzeigen-Fotos formatfüllend */}
      <div className={`relative h-44 ${deal.image_url && !imageFailed && !photo ? 'bg-white' : 'bg-raised'}`}>
        {deal.image_url && !imageFailed ? (
          <img
            src={deal.image_url}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            className={`size-full ${photo ? 'object-cover' : 'object-contain p-2'}`}
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted/60">
            <ImageOff className="size-8" aria-label="Kein Bild vorhanden" />
          </div>
        )}
        <div className="absolute left-3 top-3">
          <ScoreBadge score={deal.ai_score} rejected={rejected} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip className="font-medium text-ink">{source}</Chip>
          {deal.merchant && deal.merchant !== source && <Chip>{deal.merchant}</Chip>}
          {deal.condition !== 'unknown' && <Chip>{OFFER_CONDITION_LABELS[deal.condition]}</Chip>}
          {deal.is_notified === 1 && (
            <Chip title="Per E-Mail gemeldet"><BellRing className="size-3" aria-hidden /> gemeldet</Chip>
          )}
        </div>

        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug" title={deal.title}>{deal.title}</h3>

        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-2xl font-bold tabular-nums">{formatEuro(deal.price)}</span>
          {saving !== null && saving > 0 && (
            <span className="text-sm text-muted">
              <s>{formatEuro(deal.reference_price!)}</s> · −{saving} %
            </span>
          )}
        </div>

        {deal.ai_summary && (
          <p className="flex gap-2 rounded-xl bg-raised p-3 text-sm leading-relaxed text-ink/90">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            <span>{deal.ai_summary}</span>
          </p>
        )}

        <div className="mt-auto space-y-2 pt-1">
          <p className="text-xs text-muted">
            {showWatch && deal.watch_query ? `${deal.watch_query} · ` : ''}
            gefunden {formatRelative(deal.found_at)}
            {deal.ai_provider ? ` · Bewertung: ${AI_LABELS[deal.ai_provider] ?? deal.ai_provider}` : ''}
          </p>
          <a
            href={deal.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-accent-strong px-3 text-sm font-medium text-on-accent transition hover:brightness-110"
          >
            Zum Angebot <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
      </div>
    </article>
  );
}
