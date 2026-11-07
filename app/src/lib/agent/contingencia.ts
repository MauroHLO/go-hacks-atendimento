// Contingência da rota: o resultado gravado do lote da fila (data/processed/fila_resultado.json,
// copiado por npm run copiar-dados) quando o proxy falha ou o limite de requisições é atingido.
// A resposta leva `contingencia.aviso`, que a tela mostra.

import fila from "../../dados/processados/fila_resultado.json";
import type { Contingencia, MotivoContingencia, ResultadoGravado } from "../rota/contrato";
import type { Resumo } from "./resumo";
import { paraRota, type ResultadoAgente } from "./servico";

const GRAVADOS = new Map<string, Resumo>(
  (fila.conversas as unknown as Resumo[]).filter((c) => c && c.decisao).map((c) => [c.conversation_id, c]),
);

const MOTIVO_TXT: Record<MotivoContingencia, string> = {
  ip_minuto: "limite de requisições por minuto",
  ip_dia: "limite de requisições por dia",
  diario: "limite diário da demonstração",
  timeout: "tempo esgotado no AI Proxy",
  rate_limit: "o AI Proxy recusou por limite (429)",
  indisponivel: "AI Proxy indisponível",
  config: "AI Proxy não configurado",
  json_invalido: "resposta inválida do classificador",
  requisicao_recusada: "requisição recusada pelo AI Proxy",
};

export function resultadoGravado(conversationId: string): Resumo | null {
  return GRAVADOS.get(conversationId) ?? null;
}

export const contingenciaGravada = async (...[entrada, motivo]: Parameters<Contingencia>): Promise<(ResultadoGravado & ResultadoAgente) | null> => {
  const caso = resultadoGravado(entrada.conversation_id);
  if (!caso) return null;
  const base = paraRota(caso, false, null);
  const aviso = `Resultado gravado no lote da fila (${MOTIVO_TXT[motivo]})${entrada.mensagem ? ": a mensagem digitada não foi processada" : ""}.`;
  const r: ResultadoGravado & ResultadoAgente = { ...base, falha: null, contingencia: { modelo: String(fila.sumario.modelo_redacao ?? "gravado"), motivo, aviso } };
  return r;
};
