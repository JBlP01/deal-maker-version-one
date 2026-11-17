import { useEffect, useMemo, useRef, useState } from 'react';
import type { WatchRun } from '../../shared/types';
import { formatDate, formatDateTime, formatEuro, formatEuroShort } from '../format';

const DAY = 86_400_000;

interface Point {
  run: WatchRun;
  time: number;
  price: number;
}

const HEIGHT = 200;
const PAD = { top: 16, right: 76, bottom: 26, left: 62 };

/** "Schöne" Achsenschritte (1/2/5 × 10^n) für 3–4 Gitterlinien. */
function niceTicks(min: number, max: number): number[] {
  const span = max - min || Math.max(1, max * 0.1);
  const rough = span / 3;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? rough;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.999; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

/**
 * Preisverlauf: Tiefstpreis der passenden Treffer je Suchlauf (eine Serie, eine Achse).
 * Hover/Fokus zeigt ein Fadenkreuz mit Tooltip; die Tabellenansicht liefert dieselben Werte ohne Hover.
 */
export function PriceChart({ runs, maxPrice }: { runs: WatchRun[]; maxPrice: number | null }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // Der Wrapper wird immer gerendert, damit die Breite auch dann gemessen wird,
  // wenn die Läufe erst nach dem ersten Rendern eintreffen.
  useEffect(() => {
    const node = wrapper.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.floor(entry.contentRect.width))));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const points = useMemo<Point[]>(
    () =>
      runs
        .filter((run) => run.lowest_price !== null)
        .map((run) => ({ run, time: new Date(run.started_at).getTime(), price: run.lowest_price! })),
    [runs],
  );

  return (
    <div ref={wrapper} className="relative w-full min-w-0 overflow-hidden" style={{ minHeight: HEIGHT }}>
      {points.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">Noch kein Preisverlauf – er entsteht mit jedem Suchlauf.</p>
      ) : (
        width > 0 && <ChartBody points={points} width={width} maxPrice={maxPrice} />
      )}
    </div>
  );
}

function ChartBody({ points, width, maxPrice }: { points: Point[]; width: number; maxPrice: number | null }) {
  const [hover, setHover] = useState<number | null>(null);

  const prices = points.map((p) => p.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  // Den Wunschpreis nur einblenden, wenn er die Skala nicht zusammenstaucht.
  const showWish = maxPrice !== null && maxPrice <= hi * 1.6 && maxPrice >= lo * 0.5;
  const ticks = niceTicks(Math.min(lo, showWish ? maxPrice! : lo) * 0.97, Math.max(hi, showWish ? maxPrice! : hi) * 1.03);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const t0 = points[0].time;
  const t1 = points[points.length - 1].time;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (time: number) => PAD.left + (t1 === t0 ? plotW / 2 : ((time - t0) / (t1 - t0)) * plotW);
  const y = (price: number) => PAD.top + (1 - (price - yMin) / (yMax - yMin || 1)) * plotH;

  // Kleine Preisspannen brauchen Cent-genaue Achsenwerte, sonst wiederholen sich gerundete Beschriftungen.
  const tickLabel = ticks.length > 1 && ticks[1] - ticks[0] < 1 ? formatEuro : formatEuroShort;
  // Liegt alles innerhalb weniger Tage, hilft erst die Uhrzeit beim Einordnen.
  const axisDate = t1 - t0 < 2 * DAY ? formatDateTime : formatDate;

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.time).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const active = hover !== null ? points[hover] : null;

  function nearest(clientX: number, target: SVGElement) {
    const px = clientX - target.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(x(points[i].time) - px) < Math.abs(x(points[best].time) - px)) best = i;
    }
    setHover(best);
  }

  return (
    <>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`Preisverlauf: Tiefstpreis je Suchlauf, zuletzt ${formatEuro(last.price)}`}
        className="block touch-none select-none"
        tabIndex={0}
        onPointerMove={(e) => nearest(e.clientX, e.currentTarget)}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? points.length - 1) - 1));
          if (e.key === 'ArrowRight') setHover((h) => Math.min(points.length - 1, (h ?? 0) + 1));
        }}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--muted)">
              {tickLabel(tick)}
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={width - PAD.right} y1={HEIGHT - PAD.bottom} y2={HEIGHT - PAD.bottom} stroke="var(--axis)" strokeWidth={1} />
        <text x={PAD.left} y={HEIGHT - 8} fontSize={11} fill="var(--muted)">{axisDate(points[0].run.started_at)}</text>
        {points.length > 1 && (
          <text x={width - PAD.right} y={HEIGHT - 8} textAnchor="end" fontSize={11} fill="var(--muted)">
            {axisDate(last.run.started_at)}
          </text>
        )}

        {showWish && (
          <g>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(maxPrice!)} y2={y(maxPrice!)} stroke="var(--muted)" strokeWidth={1} strokeDasharray="4 4" />
            <text x={width - PAD.right + 6} y={y(maxPrice!)} dominantBaseline="middle" fontSize={11} fill="var(--muted)">Wunschpreis</text>
          </g>
        )}

        {active && (
          <line x1={x(active.time)} x2={x(active.time)} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="var(--axis)" strokeWidth={1} />
        )}
        <path d={path} fill="none" stroke="var(--series)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {/* Endpunkt direkt beschriftet; der Hover-Punkt bekommt einen Ring in Flächenfarbe */}
        <circle cx={x(last.time)} cy={y(last.price)} r={4} fill="var(--series)" stroke="var(--surface)" strokeWidth={2} />
        {!(showWish && Math.abs(y(last.price) - y(maxPrice!)) < 12) && (
          <text x={x(last.time) + 8} y={y(last.price)} dominantBaseline="middle" fontSize={12} fontWeight={600} fill="var(--ink)">
            {formatEuroShort(last.price)}
          </text>
        )}
        {active && <circle cx={x(active.time)} cy={y(active.price)} r={5} fill="var(--series)" stroke="var(--surface)" strokeWidth={2} />}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute z-10 w-44 rounded-lg border border-line bg-raised px-3 py-2 text-xs shadow-lg"
          style={{
            left: Math.min(Math.max(x(active.time) - 88, 0), width - 176),
            top: Math.max(y(active.price) - 86, 0),
          }}
        >
          <div className="text-muted">{formatDateTime(active.run.started_at)}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-0.5 w-3 rounded" style={{ background: 'var(--series)' }} />
            <span className="text-sm font-semibold tabular-nums">{formatEuro(active.price)}</span>
            <span className="text-muted">Tiefstpreis</span>
          </div>
          <div className="mt-0.5 text-muted">
            {active.run.median_price !== null ? `Median ${formatEuro(active.run.median_price)} · ` : ''}
            {active.run.match_count} Treffer
          </div>
        </div>
      )}
    </>
  );
}

export function PriceTable({ runs }: { runs: WatchRun[] }) {
  const rows = [...runs].reverse();
  return (
    <div className="max-h-[200px] overflow-auto">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-surface text-xs text-muted">
          <tr>
            <th className="py-1.5 pr-3 font-medium">Suchlauf</th>
            <th className="py-1.5 pr-3 text-right font-medium">Tiefstpreis</th>
            <th className="py-1.5 pr-3 text-right font-medium">Median</th>
            <th className="py-1.5 text-right font-medium">Treffer</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((run) => (
            <tr key={run.id} className="border-t border-line">
              <td className="py-1.5 pr-3 text-muted">{formatDateTime(run.started_at)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{run.lowest_price !== null ? formatEuro(run.lowest_price) : '–'}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-muted">{run.median_price !== null ? formatEuro(run.median_price) : '–'}</td>
              <td className="py-1.5 text-right tabular-nums text-muted">{run.match_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
