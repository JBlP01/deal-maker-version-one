import type { Env } from '../env';
import type { ChatPrompt } from './prompt';

export type AiProviderId = 'workers-ai' | 'gemini' | 'groq' | 'none';

const TIMEOUT_MS = 30_000;

export function resolveAiProvider(env: Env): AiProviderId {
  const wanted = (env.AI_PROVIDER ?? 'workers-ai').toLowerCase();
  return wanted === 'gemini' || wanted === 'groq' || wanted === 'none' ? wanted : 'workers-ai';
}

/** Ist der gewählte Anbieter nutzbar (Binding bzw. API-Key vorhanden)? */
export function isAiReady(env: Env): boolean {
  switch (resolveAiProvider(env)) {
    case 'workers-ai': return Boolean(env.AI);
    case 'gemini': return Boolean(env.GEMINI_API_KEY);
    case 'groq': return Boolean(env.GROQ_API_KEY);
    default: return false;
  }
}

async function callWorkersAi(env: Env, prompt: ChatPrompt): Promise<unknown> {
  if (!env.AI) throw new Error('Workers-AI-Binding fehlt');
  const model = env.WORKERS_AI_MODEL || '@cf/meta/llama-3.1-8b-instruct';
  const result = (await env.AI.run(model as keyof AiModels, {
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    max_tokens: 2048,
    temperature: 0.2,
    response_format: { type: 'json_schema', json_schema: prompt.schema },
  } as never)) as { response?: unknown };
  return result?.response ?? result;
}

async function callGemini(env: Env, prompt: ChatPrompt): Promise<unknown> {
  const model = env.GEMINI_MODEL || 'gemini-flash-latest';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY ?? '' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
}

async function callGroq(env: Env, prompt: ChatPrompt): Promise<unknown> {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.GROQ_API_KEY ?? ''}` },
    body: JSON.stringify({
      model: env.GROQ_MODEL || 'llama-3.1-8b-instant',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Groq HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

/** Schickt den Prompt an den konfigurierten Anbieter und gibt dessen Rohantwort zurück (String oder Objekt). */
export async function callModel(env: Env, prompt: ChatPrompt): Promise<unknown> {
  switch (resolveAiProvider(env)) {
    case 'workers-ai': return callWorkersAi(env, prompt);
    case 'gemini': return callGemini(env, prompt);
    case 'groq': return callGroq(env, prompt);
    default: throw new Error('KI ist deaktiviert (AI_PROVIDER=none)');
  }
}
