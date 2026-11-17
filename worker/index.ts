import { Hono } from 'hono';
import { notifyTopDeals } from './email/notify';
import type { Env } from './env';
import { runDueWatches } from './pipeline';
import { api } from './routes/api';

const app = new Hono<{ Bindings: Env }>();
app.route('/api', api);
// Alles außerhalb von /api beantwortet das gebaute Frontend (SPA-Fallback über Static Assets).
app.all('*', (c) => (c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.notFound()));

export default {
  fetch: app.fetch,

  /** Cron Trigger (alle 6 Stunden, siehe wrangler.toml): fällige Suchaufträge ausführen und Digest verschicken. */
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const watchIds = await runDueWatches(env);
        const email = await notifyTopDeals(env, watchIds);
        console.log(`[cron] ${watchIds.length} Suchaufträge geprüft, ${email.sent} Deals gemeldet`, email.skipped ?? email.error ?? '');
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
