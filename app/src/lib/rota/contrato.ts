// Contrato entre a rota e o pipeline do agente (docs/decisoes.md, seções 2 e 7).
// A rota só depende deste formato mínimo; lib/agent/servico.ts o implementa com o orquestrador,
// e app/api/agent/route.ts injeta os dois.

import type { Nivel } from "../policy";

export const RAZAO_FALHA = "falha interna: revisão humana";

// Falhas do provedor do modelo, mais "interno" (exceção fora do cliente do modelo).
export type TipoFalha =
  | "timeout"
  | "rate_limit"
  | "json_invalido"
  | "config"
  | "requisicao_recusada"
  | "indisponivel"
  | "interno";

// Conversa da fila e, opcionalmente, uma mensagem fictícia ligada ao pedido dela.
export interface EntradaRota {
  conversation_id: string;
  mensagem: string | null;
}

// Campos que a rota lê; o pipeline pode devolver mais (vão na resposta como estão).
export interface ResultadoPipeline {
  nivel: Nivel;
  razoes: string[];
  resposta: string | null; // nunca no nível 2
  classificacaoValida: boolean;
  falha: { tipo: TipoFalha } | null;
  chamadas: unknown[]; // telemetria sem texto
  tentativasRedacao: number;
  [campo: string]: unknown;
}

export type Processar = (entrada: EntradaRota) => Promise<ResultadoPipeline>;

export function resultadoFalha(tipo: TipoFalha): ResultadoPipeline {
  return {
    nivel: 2,
    razoes: [RAZAO_FALHA],
    resposta: null,
    classificacaoValida: false,
    falha: { tipo },
    chamadas: [],
    tentativasRedacao: 0,
  };
}

// Contingência: resultado gravado (data/processed/fila_resultado.json) quando há limite ou falha do provedor.
// A tela avisa que o resultado é gravado.
export type MotivoContingencia = "ip_minuto" | "ip_dia" | "diario" | Exclude<TipoFalha, "interno">;
export const FALHAS_COM_CONTINGENCIA: ReadonlySet<string> = new Set<MotivoContingencia>([
  "timeout",
  "rate_limit",
  "indisponivel",
  "config",
  "json_invalido",
  "requisicao_recusada",
]);
export type ResultadoGravado = ResultadoPipeline & { contingencia: { modelo: string; motivo: MotivoContingencia; aviso: string } };
export type Contingencia = (entrada: EntradaRota, motivo: MotivoContingencia) => Promise<ResultadoGravado | null>;
export const semContingencia: Contingencia = async () => null;
