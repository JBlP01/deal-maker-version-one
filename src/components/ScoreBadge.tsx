import { EyeOff } from 'lucide-react';

export function scoreTier(score: number): { label: string; className: string } {
  if (score >= 8) return { label: 'Top-Deal', className: 'bg-good text-white' };
  if (score >= 5) return { label: 'Solide', className: 'bg-warning text-black' };
  return { label: 'Schwach', className: 'bg-critical text-white' };
}

/** Deal-Score: Farbe + Zahl + Wort, damit die Bedeutung nie nur an der Farbe hängt. */
export function ScoreBadge({ score, rejected, compact }: { score: number | null; rejected?: boolean; compact?: boolean }) {
  if (rejected) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-line bg-raised px-2.5 py-1 text-xs font-medium text-muted">
        <EyeOff className="size-3.5" aria-hidden /> Aussortiert
      </span>
    );
  }
  if (score === null) return <span className="rounded-full bg-raised px-2.5 py-1 text-xs text-muted">Unbewertet</span>;
  const tier = scoreTier(score);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tier.className}`}
      title={`Deal-Score ${score} von 10`}
    >
      <span className="text-sm leading-none tabular-nums">{score}</span>
      <span className="opacity-80">/10</span>
      {!compact && <span>· {tier.label}</span>}
    </span>
  );
}
