// Apoio de testes: fetch simulado do AI Proxy (nenhuma chamada de rede).
// Cada rota tem uma fila de respostas; a última se repete. Guarda as requisições para inspeção.

import { criarClienteProxy, type ClienteIA } from "./cliente";

export type RespostaFalsa = { status?: number; json?: unknown; atraso?: "pendurar" } | Error;

export interface ChamadaFalsa {
  url: string;
  corpo: Record<string, unknown>;
  headers: Record<string, string>;
}

// Resposta do Jev no formato real, a partir de um motivo e sinais.
export function respostaJev(motivo: string, o: { confianca?: number; urgencia?: 0 | 1 | 2; sinais?: Record<string, number>; custo?: number } = {}) {
  const sinais = {
    reacao_adversa: 0,
    mencao_saude: 0,
    ameaca_reclame_aqui_ou_procon: 0,
    cliente_irritado: 0,
    pede_ou_envia_dado_sensivel: 0,
    mais_de_um_motivo: 0,
    ...o.sinais,
  };
  const u = o.urgencia ?? 1;
  return {
    model: "jev-teste",
    answers: {
      motivo: { type: "choice", choice: motivo, confidence: o.confianca ?? 0.95, probabilities: { [motivo]: o.confianca ?? 0.95 } },
      urgencia: { type: "score", score: u, confidence: 0.9, legend: { 0: "baixa", 1: "media", 2: "alta" }, probabilities: { 0: u === 0 ? 0.9 : 0.05, 1: u === 1 ? 0.9 : 0.05, 2: u === 2 ? 0.9 : 0.05 } },
      ...Object.fromEntries(Object.entries(sinais).map(([k, v]) => [k, { type: "noul", noul: v }])),
    },
    usage: { input_tokens: 100, output_tokens: 20, estimated_cost_usd: o.custo ?? 0.00004 },
  };
}

export function respostaChat(texto: string) {
  return { model: "modelo-teste", choices: [{ message: { content: texto }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 10 } };
}

export function fetchFalso(rotas: { jev?: RespostaFalsa[]; chat?: RespostaFalsa[] }) {
  const chamadas: ChamadaFalsa[] = [];
  const filas = { jev: [...(rotas.jev ?? [])], chat: [...(rotas.chat ?? [])] };
  const proxima = (k: "jev" | "chat") => (filas[k].length > 1 ? filas[k].shift()! : filas[k][0]);
  const f = (async (url: string, init: RequestInit) => {
    const corpo = JSON.parse(String(init.body)) as Record<string, unknown>;
    chamadas.push({ url, corpo, headers: init.headers as Record<string, string> });
    const r = proxima(url.endsWith("/systemone") ? "jev" : "chat");
    if (!r) throw new Error("sem resposta configurada");
    if (r instanceof Error) throw r;
    if (r.atraso === "pendurar") {
      return new Promise((_, rejeita) => init.signal?.addEventListener("abort", () => rejeita(new DOMException("abortado", "AbortError"))));
    }
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetch: f, chamadas };
}

export function clienteFalso(rotas: Parameters<typeof fetchFalso>[0]): { ia: ClienteIA; chamadas: ChamadaFalsa[] } {
  const { fetch, chamadas } = fetchFalso(rotas);
  return { ia: criarClienteProxy({ baseUrl: "https://proxy.teste/v1", apiKey: "chave-de-teste", modelo: "modelo-teste", fetch }), chamadas };
}
