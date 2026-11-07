// Contrato entre a rota e o pipeline do agente (docs/decisoes.md, seção 2).
// No projeto de referência a rota importava o pipeline antigo (lib/agent) e a contingência da demo.
// Aqui o pipeline é injetado: a rota só depende deste formato mínimo, e o novo lib/agent (Jev)
// vai implementá-lo. Até lá, quem montar a rota precisa passar `processar`.

import type { Canal, Nivel, StatusEntrega } from "../policy";

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

export interface ContextoRota {
  statusEntrega: StatusEntrega;
  canal: Canal;
  valor: number;
  seq: number;
}

export interface EntradaRota {
  mensagem: string;
  contexto: ContextoRota;
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

// Contingência: resposta gravada para exemplos prontos quando há limite ou falha do provedor.
// Sem exemplos gravados neste projeto ainda; a rota funciona sem ela.
export type MotivoContingencia = "ip_minuto" | "ip_dia" | "diario" | Exclude<TipoFalha, "interno">;
export const FALHAS_COM_CONTINGENCIA: ReadonlySet<string> = new Set<MotivoContingencia>([
  "timeout",
  "rate_limit",
  "indisponivel",
  "config",
  "json_invalido",
  "requisicao_recusada",
]);
export type ResultadoGravado = ResultadoPipeline & { contingencia: { modelo: string } };
export type Contingencia = (
  mensagem: string,
  contexto: ContextoRota,
  motivo: MotivoContingencia,
) => Promise<ResultadoGravado | null>;
export const semContingencia: Contingencia = async () => null;
