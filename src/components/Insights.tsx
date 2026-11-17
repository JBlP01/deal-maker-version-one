import { ChartLine, CircleCheck, CircleX, ExternalLink, Table2, Timer, Trophy } from 'lucide-react';
import { useState } from 'react';
import type { Deal, WatchRun, WatchWithStats } from '../../shared/types';
import { AI_LABELS, formatEuro, formatRelative, OFFER_CONDITION_LABELS, sourceLabel } from '../format';
import { PriceChart, PriceTable } from './PriceChart';
import { ScoreBadge } from './ScoreBadge';
import { Chip } from './ui';

interface Props {
  watch: WatchWithStats;
  topDeals: Deal[];
  runs: WatchRun[];
}

function Verdict({ watch }: { watch: WatchWithStats }) {
  if (!watch.ai_verdict) return null;
  return (
    <section className="rounded-2xl border border-accent/40 bg-surface p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Trophy className="size-4 text-accent" aria-hidden /> Top-Empfehlung der Woche
      </h3>
      <p className="mt-2 text-[15px] leading-relaxed">{watch.ai_verdict}</p>
      {watch.ai_verdict_at && <p className="mt-2 text-xs text-muted">Fazit aktualisiert {formatRelative(watch.ai_verdict_at)}</p>}
    </section>
  );
}

function CompareTable({ deals }: { deals: Deal[] }) {
  if (deals.length === 0) return <p className="py-8 text-center text-sm text-muted">Noch keine passenden Treffer.</p>;
  const cheapest = Math.min(...deals.map((d) => d.price));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-left text-sm">
        <thead className="text-xs text-muted">
          <tr>
            <th className="py-1.5 pr-3 font-medium">Angebot</th>
            <th className="py-1.5 pr-3 font-medium">Quelle</th>
            <th className="py-1.5 pr-3 text-right font-medium">Preis</th>
            <th className="py-1.5 pr-3 text-right font-medium">Score</th>
            <th className="py-1.5" aria-label="Link" />
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr key={deal.id} className="border-t border-line align-top">
              <td className="max-w-[240px] py-2 pr-3">
                <div className="line-clamp-2 font-medium" title={deal.title}>{deal.title}</div>
                {deal.condition !== 'unknown' && <div className="text-xs text-muted">{OFFER_CONDITION_LABELS[deal.condition]}</div>}
              </td>
              <td className="py-2 pr-3 text-muted">
                {sourceLabel(deal.source)}
                {deal.merchant && <div className="text-xs">{deal.merchant}</div>}
              </td>
              <td className="whitespace-nowrap py-2 pr-3 text-right font-semibold tabular-nums">
                {formatEuro(deal.price)}
                <div className="text-xs font-normal text-muted">
                  {deal.price === cheapest ? 'günstigster' : `+${formatEuro(deal.price - cheapest)}`}
                </div>
              </td>
              <td className="py-2 pr-3 text-right"><ScoreBadge score={deal.ai_score} compact /></td>
              <td className="py-2 text-right">
                <a href={deal.url} target="_blank" rel="noopener noreferrer" aria-label={`Angebot öffnen: ${deal.title}`} className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-raised hover:text-ink">
                  <ExternalLink className="size-4" />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LastRun({ run }: { run: WatchRun }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
      <span>Letzter Lauf {formatRelative(run.finished_at)} · {run.found_count} Treffer, {run.new_count} neu{run.ai_provider ? ` · Bewertung: ${AI_LABELS[run.ai_provider] ?? run.ai_provider}` : ''}</span>
      {run.sources.map((source) => (
        <Chip
          key={source.id}
          title={source.skipped ? 'Pausiert nach Blockade (Cooldown)' : source.error ?? `${source.count} Treffer in ${source.ms} ms`}
        >
          {source.ok ? <CircleCheck className="size-3 text-good" aria-hidden /> : source.skipped ? <Timer className="size-3" aria-hidden /> : <CircleX className="size-3 text-critical" aria-hidden />}
          {source.label}
          {source.ok ? ` ${source.count}` : source.skipped ? ' pausiert' : source.blocked ? ' blockiert' : ' Fehler'}
        </Chip>
      ))}
    </div>
  );
}

export function Insights({ watch, topDeals, runs }: Props) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const lastRun = runs[runs.length - 1];
  return (
    <div className="space-y-4">
      <Verdict watch={watch} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="min-w-0 rounded-2xl border border-line bg-surface p-4">
          <h3 className="mb-2 text-sm font-semibold">Preisvergleich · Top-Treffer</h3>
          <CompareTable deals={topDeals} />
        </section>
        <section className="min-w-0 rounded-2xl border border-line bg-surface p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Preisverlauf · Tiefstpreis je Suchlauf</h3>
            <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Darstellung">
              {([['chart', ChartLine, 'Diagramm'], ['table', Table2, 'Tabelle']] as const).map(([key, Icon, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view === key}
                  aria-label={label}
                  title={label}
                  onClick={() => setView(key)}
                  className={`inline-flex size-7 items-center justify-center rounded-md ${view === key ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}
                >
                  <Icon className="size-4" />
                </button>
              ))}
            </div>
          </div>
          {view === 'chart' ? <PriceChart runs={runs} maxPrice={watch.max_price} /> : <PriceTable runs={runs} />}
        </section>
      </div>
      {lastRun && <LastRun run={lastRun} />}
    </div>
  );
}
