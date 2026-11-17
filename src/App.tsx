import { Bot, Globe, Mail, Moon, Plus, Radar, RefreshCw, Settings, Sun } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings, AppStatus, Deal, DealSort, RunSummary, WatchInput, WatchRun, WatchWithStats } from '../shared/types';
import { api, ApiError, getPassword, setPassword } from './api';
import { DealCard } from './components/DealCard';
import { Insights } from './components/Insights';
import { LoginGate } from './components/LoginGate';
import { SettingsModal } from './components/SettingsModal';
import { Button, Chip, IconButton, selectClass, Toasts, type Toast } from './components/ui';
import { WatchForm } from './components/WatchForm';
import { WatchList } from './components/WatchList';
import { AI_LABELS, SEARCH_LABELS, sourceLabel } from './format';

type Theme = 'dark' | 'light';
type Auth = 'checking' | 'ok' | 'login' | 'login-failed';

const SORT_LABELS: Record<DealSort, string> = { score: 'Bester Deal-Score', price: 'Niedrigster Preis', recent: 'Neueste zuerst' };

function runMessage(query: string, summary: RunSummary): string {
  const failed = summary.sources.filter((s) => !s.ok && !s.skipped).map((s) => s.label);
  const lines = [`„${query}“: ${summary.found} Treffer, davon ${summary.new} neu und ${summary.matched} passend.`];
  if (failed.length) lines.push(`Nicht erreichbar: ${failed.join(', ')}.`);
  if (summary.email.sent) lines.push(`${summary.email.sent} Top-Deal(s) per E-Mail gemeldet.`);
  if (summary.email.error) lines.push(`E-Mail-Versand fehlgeschlagen: ${summary.email.error}`);
  return lines.join('\n');
}

export default function App() {
  const [auth, setAuth] = useState<Auth>('checking');
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'));
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [watches, setWatches] = useState<WatchWithStats[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [topDeals, setTopDeals] = useState<Deal[]>([]);
  const [runs, setRuns] = useState<WatchRun[]>([]);
  const [sort, setSort] = useState<DealSort>('score');
  const [minScore, setMinScore] = useState(1);
  const [source, setSource] = useState('');
  const [includeRejected, setIncludeRejected] = useState(false);
  const [runningIds, setRunningIds] = useState<Set<number>>(new Set());
  const [form, setForm] = useState<{ watch: WatchWithStats | null } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [fatal, setFatal] = useState('');
  const [version, setVersion] = useState(0); // erhöht sich nach jeder Änderung → Daten neu laden
  const toastId = useRef(0);
  const passwordTried = useRef(false);

  const notify = useCallback((kind: Toast['kind'], message: string) => {
    const id = ++toastId.current;
    setToasts((current) => [...current.slice(-3), { id, kind, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), kind === 'error' ? 9000 : 6000);
  }, []);

  /** Einheitliche Fehlerbehandlung: 401 führt zur Anmeldung, alles andere wird gemeldet. */
  const handleError = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) setAuth(passwordTried.current ? 'login-failed' : 'login');
      else notify('error', error instanceof Error ? error.message : 'Unbekannter Fehler');
    },
    [notify],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('dealscout-theme', theme); } catch { /* egal */ }
  }, [theme]);

  // Grunddaten: Status, Einstellungen, Suchaufträge
  useEffect(() => {
    if (auth === 'login' || auth === 'login-failed') return;
    let cancelled = false;
    // Ohne gespeichertes Passwort erst fragen, ob eines nötig ist – statt drei 401-Antworten zu provozieren.
    const ready = auth === 'checking' && !getPassword() ? api.authRequired().then((r) => !r.required) : Promise.resolve(true);
    ready
      .then((open) => {
        if (!open) throw new ApiError('Nicht angemeldet', 401);
        return Promise.all([api.status(), api.settings(), api.watches()]);
      })
      .then(([nextStatus, nextSettings, nextWatches]) => {
        if (cancelled) return;
        setStatus(nextStatus);
        setSettings(nextSettings);
        setWatches(nextWatches);
        setAuth('ok');
        setFatal('');
        setSelectedId((current) =>
          current !== null && nextWatches.some((w) => w.id === current) ? current : nextWatches.length === 1 ? nextWatches[0].id : null,
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) handleError(error);
        else setFatal(error instanceof Error ? error.message : 'Laden fehlgeschlagen');
      });
    return () => { cancelled = true; };
  }, [auth, version, handleError]);

  // Deal-Feed (abhängig von Auswahl, Sortierung und Filtern)
  useEffect(() => {
    if (auth !== 'ok') return;
    let cancelled = false;
    api.deals({ watchId: selectedId, sort, minScore, source, includeRejected })
      .then((next) => { if (!cancelled) setDeals(next); })
      .catch(handleError);
    return () => { cancelled = true; };
  }, [auth, selectedId, sort, minScore, source, includeRejected, version, handleError]);

  // Vergleichstabelle + Preisverlauf für den gewählten Suchauftrag
  useEffect(() => {
    if (auth !== 'ok' || selectedId === null) return;
    let cancelled = false;
    Promise.all([
      api.deals({ watchId: selectedId, sort: 'score', minScore: 1, source: '', includeRejected: false, limit: 5 }),
      api.runs(selectedId),
    ])
      .then(([top, nextRuns]) => {
        if (cancelled) return;
        setTopDeals(top);
        setRuns(nextRuns);
      })
      .catch(handleError);
    return () => { cancelled = true; };
  }, [auth, selectedId, version, handleError]);

  const refresh = () => setVersion((v) => v + 1);

  async function runWatch(watch: { id: number; query: string }) {
    setRunningIds((current) => new Set(current).add(watch.id));
    try {
      const summary = await api.runWatch(watch.id);
      notify(summary.email.error ? 'error' : 'success', runMessage(watch.query, summary));
    } catch (error) {
      handleError(error);
    } finally {
      setRunningIds((current) => {
        const next = new Set(current);
        next.delete(watch.id);
        return next;
      });
      refresh();
    }
  }

  async function submitWatch(input: WatchInput) {
    const editing = form?.watch;
    if (editing) {
      await api.updateWatch(editing.id, input);
      notify('success', 'Suchauftrag gespeichert');
      setForm(null);
      refresh();
      return;
    }
    const created = await api.createWatch(input);
    setForm(null);
    setSelectedId(created.id);
    refresh();
    void runWatch(created); // direkt den ersten Suchlauf starten
  }

  async function toggleWatch(watch: WatchWithStats) {
    try {
      await api.updateWatch(watch.id, { is_active: watch.is_active !== 1 });
      notify('info', watch.is_active === 1 ? `„${watch.query}“ pausiert` : `„${watch.query}“ läuft wieder automatisch`);
      refresh();
    } catch (error) {
      handleError(error);
    }
  }

  async function deleteWatch(watch: WatchWithStats) {
    if (!window.confirm(`Suchauftrag „${watch.query}“ mit allen gefundenen Deals löschen?`)) return;
    try {
      await api.deleteWatch(watch.id);
      if (selectedId === watch.id) setSelectedId(null);
      notify('info', 'Suchauftrag gelöscht');
      refresh();
    } catch (error) {
      handleError(error);
    }
  }

  if (auth === 'login' || auth === 'login-failed') {
    return (
      <LoginGate
        failed={auth === 'login-failed'}
        onSubmit={(password) => {
          setPassword(password);
          passwordTried.current = true;
          setAuth('checking');
        }}
      />
    );
  }

  const selected = watches?.find((w) => w.id === selectedId) ?? null;
  const filtersActive = minScore > 1 || source !== '' || includeRejected;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-strong text-on-accent"><Radar className="size-5" aria-hidden /></span>
            <div className="min-w-0">
              <h1 className="text-base font-bold leading-tight">DealScout AI</h1>
              <p className="truncate text-xs text-muted">Deals suchen, vergleichen, bewerten</p>
            </div>
          </div>
          {status && (
            <div className="hidden flex-wrap items-center gap-1.5 md:flex">
              <Chip title="Bewertung der Angebote"><Bot className="size-3.5" aria-hidden /> {status.ai_ready ? AI_LABELS[status.ai_provider] : 'Regelbasiert'}</Chip>
              <Chip title="Anbieter der Web-Suche"><Globe className="size-3.5" aria-hidden /> {SEARCH_LABELS[status.search_provider] ?? status.search_provider}</Chip>
              <Chip title={status.email_ready ? 'E-Mail-Benachrichtigung aktiv' : 'E-Mail-Benachrichtigung nicht eingerichtet'}>
                <Mail className="size-3.5" aria-hidden /> {status.email_ready ? 'E-Mail aktiv' : 'E-Mail aus'}
              </Chip>
            </div>
          )}
          <IconButton label={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </IconButton>
          <IconButton label="Einstellungen" onClick={() => setShowSettings(true)} disabled={!status || !settings}>
            <Settings className="size-4" />
          </IconButton>
        </div>
      </header>

      {fatal ? (
        <div className="mx-auto max-w-xl p-8 text-center">
          <p className="rounded-2xl border border-critical bg-surface p-6 text-sm">{fatal}</p>
          <Button className="mt-4" icon={<RefreshCw className="size-4" />} onClick={refresh}>Erneut versuchen</Button>
        </div>
      ) : watches === null ? (
        <p className="p-10 text-center text-sm text-muted">Lädt …</p>
      ) : watches.length === 0 ? (
        <div className="mx-auto max-w-lg px-4 py-20 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-raised text-accent"><Radar className="size-7" aria-hidden /></span>
          <h2 className="mt-5 text-xl font-semibold">Lege deinen ersten Suchauftrag an</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            DealScout durchsucht mehrere Quellen, sortiert Zubehör und unpassende Treffer aus, bewertet jedes Angebot
            mit einem Deal-Score und prüft danach automatisch alle 6 Stunden auf Neues.
          </p>
          <Button variant="primary" className="mt-6" icon={<Plus className="size-4" />} onClick={() => setForm({ watch: null })}>
            Suchauftrag anlegen
          </Button>
        </div>
      ) : (
        <main className="mx-auto grid max-w-[1440px] grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <WatchList
            watches={watches}
            selectedId={selectedId}
            runningIds={runningIds}
            onSelect={setSelectedId}
            onCreate={() => setForm({ watch: null })}
            onEdit={(watch) => setForm({ watch })}
            onRun={(watch) => void runWatch(watch)}
            onToggle={(watch) => void toggleWatch(watch)}
            onDelete={(watch) => void deleteWatch(watch)}
          />

          <div className="min-w-0 space-y-5">
            {selected && <Insights watch={selected} topDeals={topDeals} runs={runs} />}

            <section className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="mr-auto text-lg font-semibold">
                  {selected ? `Deals für „${selected.query}“` : 'Alle Deals'}
                  {deals && <span className="ml-2 text-sm font-normal text-muted">{deals.length}</span>}
                </h2>
                <select className={selectClass} value={sort} onChange={(e) => setSort(e.target.value as DealSort)} aria-label="Sortierung">
                  {(Object.keys(SORT_LABELS) as DealSort[]).map((key) => <option key={key} value={key}>{SORT_LABELS[key]}</option>)}
                </select>
                <select className={selectClass} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} aria-label="Mindest-Score">
                  <option value={1}>Alle Scores</option>
                  <option value={5}>Score ab 5</option>
                  <option value={7}>Score ab 7</option>
                  <option value={8}>Score ab 8</option>
                </select>
                <select className={selectClass} value={source} onChange={(e) => setSource(e.target.value)} aria-label="Quelle">
                  <option value="">Alle Quellen</option>
                  {status?.sources.filter((s) => s.enabled || s.id === source).map((s) => <option key={s.id} value={s.id}>{sourceLabel(s.id)}</option>)}
                </select>
                <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-raised px-2.5 text-sm">
                  <input type="checkbox" checked={includeRejected} onChange={(e) => setIncludeRejected(e.target.checked)} className="size-4 accent-(--accent)" />
                  Aussortierte zeigen
                </label>
              </div>

              {deals === null ? (
                <p className="py-10 text-center text-sm text-muted">Lädt …</p>
              ) : deals.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-muted">
                  {filtersActive
                    ? 'Kein Deal passt zu diesen Filtern.'
                    : selected && runningIds.has(selected.id)
                      ? 'Suche läuft – die ersten Ergebnisse erscheinen gleich …'
                      : 'Noch keine Deals. Starte mit „Jetzt suchen“ den ersten Suchlauf.'}
                  {filtersActive && (
                    <div className="mt-3">
                      <Button onClick={() => { setMinScore(1); setSource(''); setIncludeRejected(false); }}>Filter zurücksetzen</Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {deals.map((deal) => <DealCard key={deal.id} deal={deal} showWatch={selected === null} />)}
                </div>
              )}
            </section>
          </div>
        </main>
      )}

      {form && <WatchForm watch={form.watch} onSubmit={submitWatch} onClose={() => setForm(null)} />}
      {showSettings && status && settings && (
        <SettingsModal
          settings={settings}
          status={status}
          onSaved={(next) => { setSettings(next); refresh(); }}
          onClose={() => setShowSettings(false)}
          notify={notify}
        />
      )}
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((t) => t.id !== id))} />
    </div>
  );
}
