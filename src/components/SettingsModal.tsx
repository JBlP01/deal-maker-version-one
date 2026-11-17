import { Send } from 'lucide-react';
import { useState } from 'react';
import type { AppSettings, AppStatus } from '../../shared/types';
import { api } from '../api';
import { AI_LABELS, formatDateTime, SEARCH_LABELS } from '../format';
import { Button, Chip, Field, inputClass, Modal } from './ui';

interface Props {
  settings: AppSettings;
  status: AppStatus;
  onSaved: (settings: AppSettings) => void;
  onClose: () => void;
  notify: (kind: 'success' | 'error', message: string) => void;
}

export function SettingsModal({ settings, status, onSaved, onClose, notify }: Props) {
  const [email, setEmail] = useState(settings.notification_email);
  const [minScore, setMinScore] = useState(settings.notify_min_score);
  const [belowMax, setBelowMax] = useState(settings.notify_below_max_price);
  const [sources, setSources] = useState(new Set(settings.enabled_sources));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const draft = (): AppSettings => ({
    notification_email: email.trim(),
    notify_min_score: minScore,
    notify_below_max_price: belowMax,
    enabled_sources: [...sources],
  });

  async function save(close: boolean): Promise<boolean> {
    setSaving(true);
    try {
      onSaved(await api.saveSettings(draft()));
      if (close) {
        notify('success', 'Einstellungen gespeichert');
        onClose();
      }
      return true;
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      if (!(await save(false))) return;
      const result = await api.testEmail();
      notify('success', `Test-E-Mail an ${result.recipient} verschickt`);
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Versand fehlgeschlagen');
    } finally {
      setTesting(false);
    }
  }

  function toggleSource(id: string) {
    setSources((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal
      title="Einstellungen"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" busy={saving} onClick={() => void save(true)}>Speichern</Button>
        </>
      }
    >
      <div className="space-y-6">
        <section className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">E-Mail-Benachrichtigung</h3>
          <Field
            label="Empfänger"
            htmlFor="settings-email"
            hint={
              status.email_recipient_source === 'env' && !email.trim()
                ? 'Leer = Adresse aus NOTIFICATION_EMAIL wird verwendet.'
                : 'Top-Deals werden als Zusammenfassung verschickt; jede URL nur einmal.'
            }
          >
            <div className="flex gap-2">
              <input
                id="settings-email"
                type="email"
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="du@example.com"
              />
              <Button busy={testing} icon={<Send className="size-4" />} onClick={() => void sendTest()} className="h-10 shrink-0">
                Testen
              </Button>
            </div>
          </Field>
          <Field label={`Melden ab Deal-Score ${minScore}`} htmlFor="settings-score">
            <input
              id="settings-score"
              type="range"
              min={1}
              max={10}
              step={1}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="w-full accent-(--accent)"
            />
          </Field>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={belowMax} onChange={(e) => setBelowMax(e.target.checked)} className="mt-0.5 size-4 accent-(--accent)" />
            <span>
              Auch melden, wenn ein Angebot unter dem Wunschpreis liegt
              <span className="block text-xs text-muted">Gilt für Suchaufträge mit Maximalpreis, unabhängig vom Score.</span>
            </span>
          </label>
          {!status.email_ready && (
            <p className="rounded-lg bg-raised p-3 text-xs text-muted">
              Der Versand ist noch nicht aktiv: Es braucht einen <code>RESEND_API_KEY</code> (Secret) und einen Empfänger.
            </p>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Quellen</h3>
          {status.sources.map((source) => (
            <label key={source.id} className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={sources.has(source.id)} onChange={() => toggleSource(source.id)} className="mt-0.5 size-4 accent-(--accent)" />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5 font-medium">
                  {source.label}
                  {source.id === 'websearch' && <Chip>{SEARCH_LABELS[status.search_provider] ?? status.search_provider}</Chip>}
                  {source.experimental && <Chip>experimentell</Chip>}
                  {source.cooldown_until && <Chip title="Nach einer Blockade pausiert">pausiert bis {formatDateTime(source.cooldown_until)}</Chip>}
                </span>
                <span className="block text-xs text-muted">{source.description}</span>
              </span>
            </label>
          ))}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">System</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">KI-Anbieter</dt>
            <dd>
              {AI_LABELS[status.ai_provider] ?? status.ai_provider}
              {!status.ai_ready && status.ai_provider !== 'none' && ' – nicht konfiguriert, regelbasierte Bewertung aktiv'}
            </dd>
            <dt className="text-muted">Automatik</dt>
            <dd>alle 6 Stunden (Cron <code>{status.cron}</code>, UTC)</dd>
          </dl>
        </section>
      </div>
    </Modal>
  );
}
