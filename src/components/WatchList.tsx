import { Layers, Pause, Pencil, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { WatchWithStats } from '../../shared/types';
import { CONDITION_LABELS, formatEuro, formatEuroShort, formatRelative } from '../format';
import { Button, Chip, IconButton } from './ui';

interface Props {
  watches: WatchWithStats[];
  selectedId: number | null;
  runningIds: Set<number>;
  onSelect: (id: number | null) => void;
  onCreate: () => void;
  onEdit: (watch: WatchWithStats) => void;
  onRun: (watch: WatchWithStats) => void;
  onToggle: (watch: WatchWithStats) => void;
  onDelete: (watch: WatchWithStats) => void;
}

export function WatchList({ watches, selectedId, runningIds, onSelect, onCreate, onEdit, onRun, onToggle, onDelete }: Props) {
  return (
    <aside className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Suchaufträge</h2>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={onCreate}>Neu</Button>
      </div>

      {watches.length > 1 && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-pressed={selectedId === null}
          className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition ${
            selectedId === null ? 'border-accent bg-raised' : 'border-line bg-surface hover:border-muted'
          }`}
        >
          <Layers className="size-4 text-muted" aria-hidden /> Alle Deals
        </button>
      )}

      {watches.map((watch) => {
        const selected = watch.id === selectedId;
        const running = runningIds.has(watch.id);
        const active = watch.is_active === 1;
        return (
          <div
            key={watch.id}
            className={`rounded-xl border bg-surface transition ${selected ? 'border-accent' : 'border-line hover:border-muted'}`}
          >
            <button
              type="button"
              onClick={() => onSelect(watch.id)}
              aria-pressed={selected}
              className="block w-full rounded-t-xl px-3 pb-2 pt-3 text-left"
            >
              <div className="flex items-start justify-between gap-2">
                <span className={`font-semibold leading-snug ${active ? '' : 'text-muted'}`}>{watch.query}</span>
                {!active && <Chip>pausiert</Chip>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {watch.max_price !== null && <Chip>bis {formatEuroShort(watch.max_price)}</Chip>}
                <Chip>{CONDITION_LABELS[watch.condition]}</Chip>
                {watch.exclude_keywords
                  .split(',')
                  .filter(Boolean)
                  .map((word) => <Chip key={word}>−{word}</Chip>)}
              </div>
              <div className="mt-2 text-xs text-muted">
                {watch.deal_count > 0
                  ? `${watch.deal_count} Deals · ab ${formatEuro(watch.lowest_price ?? 0)} · bester Score ${watch.best_score ?? '–'}`
                  : watch.last_checked_at ? 'Keine passenden Deals' : 'Noch nicht gesucht'}
                {' · '}
                {running ? 'sucht gerade …' : `geprüft ${formatRelative(watch.last_checked_at)}`}
              </div>
            </button>
            <div className="flex items-center gap-1 border-t border-line px-2 py-1.5">
              <Button
                variant="ghost"
                className="h-8 px-2"
                busy={running}
                icon={<RefreshCw className="size-4" />}
                onClick={() => onRun(watch)}
              >
                Jetzt suchen
              </Button>
              <span className="flex-1" />
              <IconButton label={active ? 'Pausieren' : 'Fortsetzen'} onClick={() => onToggle(watch)}>
                {active ? <Pause className="size-4" /> : <Play className="size-4" />}
              </IconButton>
              <IconButton label="Bearbeiten" onClick={() => onEdit(watch)}><Pencil className="size-4" /></IconButton>
              <IconButton label="Löschen" tone="danger" onClick={() => onDelete(watch)}><Trash2 className="size-4" /></IconButton>
            </div>
          </div>
        );
      })}
    </aside>
  );
}
