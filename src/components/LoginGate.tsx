import { Lock } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, inputClass } from './ui';

export function LoginGate({ onSubmit, failed }: { onSubmit: (password: string) => void; failed: boolean }) {
  const [password, setPassword] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    if (password) onSubmit(password);
  }
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-6">
        <div className="flex items-center gap-2 text-lg font-semibold"><Lock className="size-5 text-accent" aria-hidden /> DealScout AI</div>
        <p className="text-sm text-muted">Dieses Dashboard ist passwortgeschützt.</p>
        <input
          type="password"
          className={inputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Passwort"
          aria-label="Passwort"
          autoFocus
        />
        {failed && <p role="alert" className="text-sm text-critical-ink">Das Passwort stimmt nicht.</p>}
        <Button variant="primary" type="submit" className="w-full">Anmelden</Button>
      </form>
    </div>
  );
}
