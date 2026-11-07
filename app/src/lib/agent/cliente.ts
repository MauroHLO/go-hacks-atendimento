// Cliente do AI Proxy da GoGroup (formato OpenAI), por fetch (docs/decisoes.md, seção 6).
// Variáveis: AI_PROXY_BASE_URL, AI_PROXY_API_KEY, AI_PROXY_MODEL (só em .env.local e na Vercel).
// Jev: POST {base}/systemone com { state, questions: { id: { type, ... } } }.
//   choice: { type: "choice", criteria: { opção: descrição } } → { choice, confidence, probabilities }
//   score:  { type: "score", criteria: [nível, ...] }          → { score, confidence, legend, probabilities }
//   noul:   { type: "noul", instructions: "pergunta sim/não" }  → { noul: probabilidade de "sim" }
// Redação: POST {base}/chat/completions.
// Nada aqui loga texto de conversa nem a chave.

import { z } from "zod";

export type TipoFalha = "config" | "timeout" | "http" | "resposta_invalida" | "rede";

export class FalhaIA extends Error {
  constructor(
    readonly tipo: TipoFalha,
    readonly status?: number,
  ) {
    super(`falha do AI Proxy: ${tipo}${status ? ` (${status})` : ""}`);
  }
}

export const TIMEOUT_JEV_MS = 10_000;
export const TIMEOUT_CHAT_MS = 30_000;

// ---------- Jev ----------
export type PerguntaJev =
  | { type: "choice"; criteria: Record<string, string> }
  | { type: "score"; criteria: string[] }
  | { type: "noul"; instructions: string };

const RespostaChoice = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number(),
  probabilities: z.record(z.string(), z.number()),
});
const RespostaScore = z.object({
  type: z.literal("score"),
  score: z.number(),
  confidence: z.number(),
  legend: z.record(z.string(), z.string()).optional(),
  probabilities: z.record(z.string(), z.number()),
});
const RespostaNoul = z.object({ type: z.literal("noul"), noul: z.number() });
export const RespostaJev = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), z.union([RespostaChoice, RespostaScore, RespostaNoul])),
  usage: z
    .object({ input_tokens: z.number(), output_tokens: z.number(), estimated_cost_usd: z.number().optional() })
    .optional(),
});
export type RespostaJev = z.infer<typeof RespostaJev>;

// ---------- Chat ----------
export interface MensagemChat {
  role: "system" | "user" | "assistant";
  content: string;
}
const RespostaChat = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }), finish_reason: z.string().nullable().optional() })).min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).partial().optional(),
});

export interface Uso {
  entrada: number;
  saida: number;
  custoUsd: number | null; // o proxy informa custo só no Jev
}

export interface ResultadoJev {
  resposta: RespostaJev;
  uso: Uso;
  ms: number;
}

export interface ResultadoChat {
  texto: string;
  modelo: string | null;
  uso: Uso;
  ms: number;
}

export interface ClienteIA {
  modelo: string;
  jev(state: string, questions: Record<string, PerguntaJev>, timeoutMs?: number): Promise<ResultadoJev>;
  chat(mensagens: MensagemChat[], opcoes?: { maxTokens?: number; timeoutMs?: number }): Promise<ResultadoChat>;
}

export interface ConfigProxy {
  baseUrl: string;
  apiKey: string;
  modelo: string;
  fetch?: typeof fetch;
  agora?: () => number;
}

export function configDoAmbiente(env: Readonly<Record<string, string | undefined>> = process.env): ConfigProxy {
  const baseUrl = env.AI_PROXY_BASE_URL?.trim();
  const apiKey = env.AI_PROXY_API_KEY?.trim();
  const modelo = env.AI_PROXY_MODEL?.trim();
  if (!baseUrl || !apiKey || !modelo) throw new FalhaIA("config");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, modelo };
}

export function criarClienteProxy(cfg: ConfigProxy): ClienteIA {
  const f = cfg.fetch ?? fetch;
  const agora = cfg.agora ?? Date.now;

  async function post(caminho: string, corpo: unknown, timeoutMs: number): Promise<{ json: unknown; ms: number }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const inicio = agora();
    try {
      const res = await f(`${cfg.baseUrl}${caminho}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new FalhaIA("http", res.status);
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new FalhaIA("resposta_invalida");
      }
      return { json, ms: agora() - inicio };
    } catch (e) {
      if (e instanceof FalhaIA) throw e;
      if (ctrl.signal.aborted) throw new FalhaIA("timeout");
      throw new FalhaIA("rede");
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    modelo: cfg.modelo,
    async jev(state, questions, timeoutMs = TIMEOUT_JEV_MS) {
      const { json, ms } = await post("/systemone", { state, questions }, timeoutMs);
      const r = RespostaJev.safeParse(json);
      if (!r.success) throw new FalhaIA("resposta_invalida");
      for (const id of Object.keys(questions)) if (!(id in r.data.answers)) throw new FalhaIA("resposta_invalida");
      const u = r.data.usage;
      return { resposta: r.data, ms, uso: { entrada: u?.input_tokens ?? 0, saida: u?.output_tokens ?? 0, custoUsd: u?.estimated_cost_usd ?? null } };
    },
    async chat(mensagens, opcoes = {}) {
      const { json, ms } = await post(
        "/chat/completions",
        { model: cfg.modelo, messages: mensagens, max_tokens: opcoes.maxTokens ?? 400 },
        opcoes.timeoutMs ?? TIMEOUT_CHAT_MS,
      );
      const r = RespostaChat.safeParse(json);
      if (!r.success) throw new FalhaIA("resposta_invalida");
      const texto = r.data.choices[0].message.content ?? "";
      return {
        texto,
        modelo: r.data.model ?? null,
        ms,
        uso: { entrada: r.data.usage?.prompt_tokens ?? 0, saida: r.data.usage?.completion_tokens ?? 0, custoUsd: null },
      };
    },
  };
}
