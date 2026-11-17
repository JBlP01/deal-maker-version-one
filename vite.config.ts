import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Das Cloudflare-Plugin lässt den Worker (API, D1, Cron) im Dev-Server in der echten
// Workers-Runtime laufen – Frontend und Backend teilen sich also einen Port.
// Unter Vitest bleibt es aus: die Unit-Tests laufen ohne Worker-Runtime.
//
// Workers AI läuft auch lokal über Cloudflare (erfordert `npx wrangler login`).
// `npm run dev:offline` setzt LOCAL_ONLY=1 und kommt ohne Cloudflare-Konto aus –
// die Bewertung übernimmt dann Gemini/Groq (falls konfiguriert) oder die regelbasierte Heuristik.
const remoteBindings = process.env.LOCAL_ONLY !== '1';

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(process.env.VITEST ? [] : [cloudflare({ remoteBindings })])],
  test: { include: ['test/**/*.test.ts'] },
});
