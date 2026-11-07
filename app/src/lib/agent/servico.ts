// Liga a rota pública POST /api/agent ao orquestrador (docs/decisoes.md, seção 7).
// - no máximo 2 conversas processadas ao mesmo tempo (o proxy devolve 429 com 5 simultâneas);
// - nova tentativa no 429 (e em 5xx/rede) também na redação; o Jev já repete no classificador;
// - cada requisição usa um Simulador novo: o log de uma não vaza para outra;
// - mensagem fictícia: vira uma conversa de teste ligada ao pedido e ao cliente da conversa escolhida,
//   sem os anexos nem as mensagens originais (só o texto digitado é classificado).
// A saída é o mesmo resumo gravado em data/processed/fila_resultado.json (lib/agent/resumo).

import { AGORA, BASE, type Base, type Conversa } from "../dados";
import { Simulador } from "../ferramentas";
import { CENARIO_PADRAO, type CenarioPolitica } from "../policy";
import type { ResultadoPipeline, TipoFalha as FalhaRota } from "../rota/contrato";
import { FalhaIA, type ClienteIA } from "./cliente";
import { ESPERA_ANTES_DE_REPETIR_MS } from "./classificador";
import { novoEstado, processarConversa, type EstadoOrquestrador } from "./orquestrador";
import { resumo, type Resumo } from "./resumo";

export const CONCORRENCIA_ROTA = 2;
export const PREFIXO_TESTE = "TESTE-";

const esperarPadrao = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

export function transitoria(e: unknown): boolean {
  return e instanceof FalhaIA && (e.tipo === "rede" || (e.tipo === "http" && (e.status === 429 || (e.status ?? 0) >= 500)));
}

// Uma nova tentativa na redação quando o proxy recusa por limite (429) ou cai (5xx/rede). Timeout não repete.
export function comNovaTentativa(ia: ClienteIA, esperar: (ms: number) => Promise<void> = esperarPadrao): ClienteIA {
  return {
    modelo: ia.modelo,
    jev: (...a) => ia.jev(...a), // o classificador já repete
    async chat(mensagens, opcoes) {
      try {
        return await ia.chat(mensagens, opcoes);
      } catch (e) {
        if (!transitoria(e)) throw e;
        await esperar(ESPERA_ANTES_DE_REPETIR_MS);
        return ia.chat(mensagens, opcoes);
      }
    },
  };
}

// Semáforo simples: no máximo `max` tarefas ao mesmo tempo; as demais esperam na ordem de chegada.
export class Semaforo {
  private ativos = 0;
  private fila: (() => void)[] = [];
  constructor(readonly max: number) {}
  get emUso(): number {
    return this.ativos;
  }
  get esperando(): number {
    return this.fila.length;
  }
  async usar<T>(f: () => Promise<T>): Promise<T> {
    if (this.ativos >= this.max) await new Promise<void>((ok) => this.fila.push(ok));
    else this.ativos++;
    try {
      return await f();
    } finally {
      const proximo = this.fila.shift();
      if (proximo) proximo(); // passa a vaga direto
      else this.ativos--;
    }
  }
}

export interface EntradaAgente {
  conversation_id: string;
  mensagem: string | null; // fictícia, opcional
}

// Base com a conversa de teste (mensagem fictícia ligada ao pedido da conversa escolhida).
export function baseComTeste(base: Base, origem: Conversa, mensagem: string, agora = AGORA): { base: Base; id: string } {
  const id = `${PREFIXO_TESTE}${origem.conversation_id}`;
  const conversa: Conversa = {
    ...origem,
    conversation_id: id,
    status: "pendente",
    data_abertura: agora,
    n_interacoes: 1,
    atendente_id: null,
    data_primeira_resposta: null,
    assunto: null,
  };
  return {
    id,
    base: {
      ...base,
      conversas: [...base.conversas.filter((c) => c.conversation_id !== id), conversa],
      mensagens: [...base.mensagens.filter((m) => m.conversation_id !== id), { conversation_id: id, message_id: `${id}-1`, autor: "cliente", timestamp: agora, texto: mensagem }],
    },
  };
}

// Falha do classificador → tipo de falha da rota (decide a contingência).
export function falhaDaRota(falha: string | null, status: number | null): FalhaRota | null {
  if (!falha) return null;
  if (falha === "timeout") return "timeout";
  if (falha === "config") return "config";
  if (falha === "resposta_invalida") return "json_invalido";
  if (falha === "http" && status === 429) return "rate_limit";
  return "indisponivel";
}

export type ResultadoAgente = ResultadoPipeline & { caso: Resumo; teste: boolean };

export function paraRota(caso: Resumo, teste: boolean, falhaStatus: number | null): ResultadoAgente {
  const falha = falhaDaRota(caso.classificacao.falha, falhaStatus);
  return {
    nivel: caso.decisao.nivel_final,
    razoes: [caso.decisao.justificativa, ...caso.decisao.ajustes],
    resposta: caso.resposta.texto || null,
    classificacaoValida: caso.classificacao.valida,
    falha: falha ? { tipo: falha } : null,
    chamadas: caso.log, // telemetria: ações registradas, sem texto do cliente
    tentativasRedacao: caso.resposta.tentativas,
    caso,
    teste,
  };
}

export interface DepsAgente {
  ia: ClienteIA;
  base?: Base;
  cenario?: CenarioPolitica;
  semaforo?: Semaforo;
  estado?: EstadoOrquestrador; // freio diário compartilhado entre requisições da mesma instância
  esperar?: (ms: number) => Promise<void>;
}

export class ConversaDesconhecida extends Error {}

export function criarAgente(deps: DepsAgente) {
  const base = deps.base ?? BASE;
  const semaforo = deps.semaforo ?? new Semaforo(CONCORRENCIA_ROTA);
  const estado = deps.estado ?? novoEstado();
  const ia = comNovaTentativa(deps.ia, deps.esperar);
  return async function processar(e: EntradaAgente): Promise<ResultadoAgente> {
    const origem = base.conversas.find((c) => c.conversation_id === e.conversation_id);
    if (!origem) throw new ConversaDesconhecida(e.conversation_id);
    const alvo = e.mensagem ? baseComTeste(base, origem, e.mensagem) : { base, id: origem.conversation_id };
    return semaforo.usar(async () => {
      const sim = new Simulador({ base: alvo.base, cenario: deps.cenario ?? CENARIO_PADRAO });
      const r = await processarConversa(alvo.id, { sim, ia, estado });
      return paraRota(resumo(r), !!e.mensagem, r.classificacao.falhaStatus);
    });
  };
}
