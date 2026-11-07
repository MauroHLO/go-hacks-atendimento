// Classificador (docs/decisoes.md, seção 6): Jev sobre as mensagens do cliente MASCARADAS (lib/pii).
// O Jev classifica; o código decide. Regras do código sobre a saída:
// - sem mensagem do cliente: "sem_demanda", sem chamar o Jev;
// - reação adversa com probabilidade >= 0,5 prevalece sobre o motivo escolhido (segurança: sempre nível 2);
// - menção de saúde = Jev (>= 0,5) OU detector por palavra-chave (lib/agent/sinais);
// - falha ou timeout de 10 s: classificação inválida → o orquestrador manda para nível 2 ("falha_classificador").

import { mascararPii } from "../pii";
import { MOTIVOS, type Motivo } from "../policy";
import { FalhaIA, TIMEOUT_JEV_MS, type ClienteIA, type PerguntaJev, type TipoFalha, type Uso } from "./cliente";
import { detectarSinais } from "./sinais";
import { DESCRICAO_MOTIVO, NIVEIS_URGENCIA, SINAIS_TEXTO, type SinalTexto, type Urgencia } from "./taxonomia";

export const LIMIAR_SINAL = 0.5;
export const TENTATIVAS_TRANSITORIAS = 2; // rede, HTTP 429 ou 5xx: mais uma tentativa; timeout não repete
export const ESPERA_ANTES_DE_REPETIR_MS = 1_500;

export interface OpcoesClassificador {
  timeoutMs?: number;
  esperar?: (ms: number) => Promise<void>; // injetável nos testes
}
const esperarPadrao = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
export const MAX_STATE = 4_000; // caracteres enviados ao Jev

export interface Classificacao {
  valida: boolean;
  falha: TipoFalha | null;
  falhaStatus: number | null; // status HTTP da falha, quando houver
  tentativas: number;
  motivo: Motivo;
  motivoJev: string | null; // escolha original do Jev (antes das regras do código)
  confianca: number; // 0 a 1; 0 quando inválida
  probabilidades: Record<string, number>;
  urgencia: Urgencia | null;
  urgenciaProbabilidades: Record<string, number>;
  sinais: Record<SinalTexto, number>; // probabilidade de "sim"
  flags: Record<SinalTexto, boolean>;
  mencaoSaude: boolean;
  semMensagemDoCliente: boolean;
  modeloJev: string | null;
  uso: Uso;
  ms: number;
}

export interface EntradaClassificador {
  mensagensCliente: readonly string[]; // em ordem; ainda sem máscara
  assunto?: string | null;
  canal?: string;
}

const SINAIS_VAZIOS = Object.fromEntries(Object.keys(SINAIS_TEXTO).map((k) => [k, 0])) as Record<SinalTexto, number>;
const FLAGS_VAZIAS = Object.fromEntries(Object.keys(SINAIS_TEXTO).map((k) => [k, false])) as Record<SinalTexto, boolean>;
const USO_ZERO: Uso = { entrada: 0, saida: 0, custoUsd: 0 };

export const PERGUNTAS: Record<string, PerguntaJev> = {
  motivo: { type: "choice", criteria: { ...DESCRICAO_MOTIVO } },
  urgencia: { type: "score", criteria: [...NIVEIS_URGENCIA] },
  ...Object.fromEntries(Object.entries(SINAIS_TEXTO).map(([id, pergunta]) => [id, { type: "noul", instructions: pergunta }])),
};

// Texto enviado ao Jev: só o que o cliente escreveu (e o assunto do e-mail/Reclame Aqui), mascarado.
export function montarState(e: EntradaClassificador): string {
  const partes: string[] = [];
  if (e.canal) partes.push(`Canal: ${e.canal}`);
  if (e.assunto) partes.push(`Assunto: ${mascararPii(e.assunto)}`);
  e.mensagensCliente.forEach((m, i) => partes.push(`Cliente (${i + 1}): ${mascararPii(m)}`));
  const texto = partes.join("\n");
  return texto.length > MAX_STATE ? texto.slice(texto.length - MAX_STATE) : texto;
}

function invalida(falha: TipoFalha | null, semMensagem: boolean, ms = 0): Classificacao {
  return {
    valida: falha === null,
    falha,
    falhaStatus: null,
    tentativas: 0,
    motivo: semMensagem ? "sem_demanda" : "outro",
    motivoJev: null,
    confianca: semMensagem ? 1 : 0,
    probabilidades: {},
    urgencia: null,
    urgenciaProbabilidades: {},
    sinais: { ...SINAIS_VAZIOS },
    flags: { ...FLAGS_VAZIAS },
    mencaoSaude: false,
    semMensagemDoCliente: semMensagem,
    modeloJev: null,
    uso: { ...USO_ZERO },
    ms,
  };
}

export async function classificar(cliente: ClienteIA, e: EntradaClassificador, opcoes: OpcoesClassificador = {}): Promise<Classificacao> {
  const timeoutMs = opcoes.timeoutMs ?? TIMEOUT_JEV_MS;
  const esperar = opcoes.esperar ?? esperarPadrao;
  const textos = e.mensagensCliente.map((m) => m.trim()).filter(Boolean);
  if (textos.length === 0 && !e.assunto?.trim()) return invalida(null, true);

  const state = montarState({ ...e, mensagensCliente: textos });
  let r;
  let tentativas = 0;
  for (;;) {
    tentativas++;
    try {
      r = await cliente.jev(state, PERGUNTAS, timeoutMs);
      break;
    } catch (err) {
      const f = err instanceof FalhaIA ? err : new FalhaIA("rede");
      const transitoria = f.tipo === "rede" || (f.tipo === "http" && (f.status === 429 || (f.status ?? 0) >= 500));
      if (!transitoria || tentativas >= TENTATIVAS_TRANSITORIAS) {
        return { ...invalida(f.tipo, false), falhaStatus: f.status ?? null, tentativas };
      }
      await esperar(ESPERA_ANTES_DE_REPETIR_MS * tentativas);
    }
  }
  const a = r.resposta.answers;
  const motivoResp = a.motivo;
  const urg = a.urgencia;
  if (motivoResp?.type !== "choice" || urg?.type !== "score") return { ...invalida("resposta_invalida", false), ms: r.ms, uso: r.uso, tentativas };

  const sinais = { ...SINAIS_VAZIOS };
  for (const k of Object.keys(SINAIS_TEXTO) as SinalTexto[]) {
    const s = a[k];
    if (s?.type !== "noul") return { ...invalida("resposta_invalida", false), ms: r.ms, uso: r.uso, tentativas };
    sinais[k] = s.noul;
  }
  const flags = Object.fromEntries(Object.entries(sinais).map(([k, v]) => [k, v >= LIMIAR_SINAL])) as Record<SinalTexto, boolean>;

  const escolhido = motivoResp.choice;
  const conhecido = (MOTIVOS as readonly string[]).includes(escolhido) && escolhido !== "sem_demanda";
  let motivo: Motivo = conhecido ? (escolhido as Motivo) : "outro";
  let confianca = conhecido ? motivoResp.confidence : 0;
  if (flags.reacao_adversa && motivo !== "reacao_adversa") {
    motivo = "reacao_adversa";
    confianca = Math.max(confianca, sinais.reacao_adversa);
  }

  // Urgência: nível mais provável do score.
  const probsUrg = Object.entries(urg.probabilities).sort((x, y) => y[1] - x[1]);
  const idx = Number(probsUrg[0]?.[0] ?? NaN);
  const urgencia = NIVEIS_URGENCIA[idx] ?? null;
  const urgenciaProbabilidades = Object.fromEntries(Object.entries(urg.probabilities).map(([k, v]) => [NIVEIS_URGENCIA[Number(k)] ?? k, v]));

  const saudePalavra = textos.some((t) => detectarSinais(t).saude);

  return {
    valida: true,
    falha: null,
    falhaStatus: null,
    tentativas,
    motivo,
    motivoJev: escolhido,
    confianca: Math.min(1, Math.max(0, confianca)),
    probabilidades: motivoResp.probabilities,
    urgencia,
    urgenciaProbabilidades,
    sinais,
    flags,
    mencaoSaude: flags.mencao_saude || flags.reacao_adversa || saudePalavra,
    semMensagemDoCliente: textos.length === 0,
    modeloJev: r.resposta.model ?? null,
    uso: r.uso,
    ms: r.ms,
  };
}
