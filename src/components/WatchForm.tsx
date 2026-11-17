import { useState, type FormEvent } from 'react';
import type { WatchCondition, WatchInput, WatchWithStats } from '../../shared/types';
import { CONDITION_LABELS } from '../format';
import { Button, Field, inputClass, Modal } from './ui';

interface Props {
  watch: WatchWithStats | null;
  onSubmit: (input: WatchInput) => Promise<void>;
  onClose: () => void;
}

const EXAMPLES = ['Mechanische Tastatur Tri-Mode', 'Noise Cancelling Kopfhörer', 'Rennrad'];

export function WatchForm({ watch, onSubmit, onClose }: Props) {
  const [query, setQuery] = useState(watch?.query ?? '');
  const [maxPrice, setMaxPrice] = useState(watch?.max_price?.toString().replace('.', ',') ?? '');
  const [condition, setCondition] = useState<WatchCondition>(watch?.condition ?? 'any');
  const [exclude, setExclude] = useState(
    watch?.exclude_keywords ? watch.exclude_keywords.split(',').map((word) => `-${word}`).join(', ') : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const price = maxPrice.trim() ? Number(maxPrice.trim().replace(/\./g, '').replace(',', '.')) : null;
    if (query.trim().length < 2) return setError('Bitte einen Suchbegriff mit mindestens 2 Zeichen eingeben.');
    if (price !== null && !(price > 0)) return setError('Der Maximalpreis muss eine positive Zahl sein.');
    setBusy(true);
    setError('');
    try {
      await onSubmit({ query: query.trim(), max_price: price, condition, exclude_keywords: exclude });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
      setBusy(false);
    }
  }

  return (
    <Modal
      title={watch ? 'Suchauftrag bearbeiten' : 'Neuer Suchauftrag'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form="watch-form" busy={busy}>
            {watch ? 'Speichern' : 'Anlegen & suchen'}
          </Button>
        </>
      }
    >
      <form id="watch-form" onSubmit={submit} className="space-y-4">
        <Field label="Produkt oder Suchbegriff" htmlFor="watch-query">
          <input
            id="watch-query"
            className={inputClass}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="z. B. Sony WH-1000XM5"
            maxLength={120}
            autoFocus
            required
          />
          {!watch && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setQuery(example)}
                  className="rounded-md bg-raised px-2 py-1 text-xs text-muted hover:text-ink"
                >
                  {example}
                </button>
              ))}
            </div>
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Maximalpreis in € (optional)" htmlFor="watch-price" hint="Teurere Angebote werden ignoriert; alles darunter gilt als Wunschpreis-Treffer.">
            <input
              id="watch-price"
              className={inputClass}
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="z. B. 150"
              inputMode="decimal"
            />
          </Field>
          <Field label="Zustand" htmlFor="watch-condition">
            <select
              id="watch-condition"
              className={inputClass}
              value={condition}
              onChange={(e) => setCondition(e.target.value as WatchCondition)}
            >
              {(Object.keys(CONDITION_LABELS) as WatchCondition[]).map((key) => (
                <option key={key} value={key}>{CONDITION_LABELS[key]}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field
          label="Ausschlusswörter (optional)"
          htmlFor="watch-exclude"
          hint="Kommagetrennt. Angebote, deren Titel eines dieser Wörter enthält, werden übersprungen."
        >
          <input
            id="watch-exclude"
            className={inputClass}
            value={exclude}
            onChange={(e) => setExclude(e.target.value)}
            placeholder="-defekt, -Karton"
            maxLength={300}
          />
        </Field>

        {error && <p role="alert" className="text-sm text-critical-ink">{error}</p>}
      </form>
    </Modal>
  );
}
