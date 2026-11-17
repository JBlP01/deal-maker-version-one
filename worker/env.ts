// Bindings und Variablen des Workers (siehe wrangler.toml und .dev.vars.example).
export interface Env {
  DB: D1Database;
  AI?: Ai;
  ASSETS?: Fetcher;

  AI_PROVIDER?: string;
  WORKERS_AI_MODEL?: string;
  GEMINI_MODEL?: string;
  GROQ_MODEL?: string;
  SEARCH_PROVIDER?: string;
  EMAIL_FROM?: string;
  MAX_WATCHES_PER_RUN?: string;

  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  SEARCH_API_KEY?: string;
  RESEND_API_KEY?: string;
  NOTIFICATION_EMAIL?: string;
  APP_PASSWORD?: string;
}
