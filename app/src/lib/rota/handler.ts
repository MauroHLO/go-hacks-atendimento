// Handler da rota pública POST /api/agent (reaproveitado do projeto de referência; docs/decisoes.md, seção 2).
// Fica fora de app/api/agent/route.ts porque o Next valida os nomes exportados pelo arquivo de rota.
// Ordem: origem -> tamanho -> JSON e zod -> limites -> pipeline. Qualquer exceção: 200 no formato do
// pipeline, nível 2, falha "interno". Nenhum texto de conversa nem de erro vai para log ou resposta.
// Mudanças: o pipeline e a contingência são injetados (./contrato.ts) e a entrada é uma conversa da fila
// (conversation_id) com mensagem fictícia opcional.

import { z } from "zod";
import {
  FALHAS_COM_CONTINGENCIA,
  resultadoFalha,
  semContingencia,
  type Contingencia,
  type MotivoContingencia,
  type Processar,
  type ResultadoPipeline,
} from "./contrato";
import {
  consumirTodos,
  DESLOCAMENTO_BRASILIA_MS,
  DIA_MS,
  LimitadorJanela,
  MINUTO_MS,
} from "../limites";

export { RAZAO_FALHA } from "./contrato";

export const LIMITE_MENSAGEM = 2_000; // caracteres
export const LIMITE_CORPO_BYTES = 10 * 1024;
export const LIMITE_IP_MINUTO = 10;
export const LIMITE_IP_DIA = 100;
export const LIMITE_DIARIO_GLOBAL_PADRAO = 300; // sobrescrito por LIMITE_DIARIO_GLOBAL
export const MENSAGEM_LIMITE = "limite da demonstração atingido";

export const CorpoAgente = z.object({
  conversation_id: z.string().regex(/^AT\d{1,9}$/),
  mensagem: z
    .string()
    .trim()
    .max(LIMITE_MENSAGEM)
    .nullish()
    .transform((m) => (m ? m : null)),
});
export type CorpoAgente = z.infer<typeof CorpoAgente>;

export type NomeLimite = "ip_minuto" | "ip_dia" | "diario";

export interface Limites {
  ipMinuto: LimitadorJanela;
  ipDia: LimitadorJanela;
  global: LimitadorJanela;
}

export function lerLimiteGlobal(env: Readonly<Record<string, string | undefined>>): number {
  const bruto = env.LIMITE_DIARIO_GLOBAL?.trim();
  if (!bruto || !/^\d+$/.test(bruto)) return LIMITE_DIARIO_GLOBAL_PADRAO;
  return Number(bruto);
}

export function criarLimitesPadrao(
  env: Readonly<Record<string, string | undefined>> = process.env,
  agora: () => number = Date.now,
): Limites {
  const dia = { janelaMs: DIA_MS, deslocamentoMs: DESLOCAMENTO_BRASILIA_MS, agora };
  return {
    ipMinuto: new LimitadorJanela({ limite: LIMITE_IP_MINUTO, janelaMs: MINUTO_MS, agora }),
    ipDia: new LimitadorJanela({ limite: LIMITE_IP_DIA, ...dia }),
    global: new LimitadorJanela({ limite: lerLimiteGlobal(env), ...dia }),
  };
}

export interface DepsRota {
  processar: Processar; // pipeline do agente (lib/agent)
  limites: Limites;
  modelo?: string;
  agora?: () => number;
  log?: (linha: string) => void;
  contingencia?: Contingencia; // padrão: nenhuma resposta gravada
}

// Linha de log: só métricas, sem IP, mensagem nem erro.
export interface LinhaLog {
  nivel: 0 | 1 | 2 | null;
  falha: string | null;
  ms: number;
  chamadas: number;
  tentativasRedacao: number; // redações checadas pelo pipeline (0, 1 ou 2)
}

const CABECALHOS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: CABECALHOS });
}

// Preferência: x-real-ip e x-vercel-forwarded-for (definidos pela Vercel); x-forwarded-for como alternativa.
export function ipDaRequisicao(h: Headers): string {
  for (const nome of ["x-real-ip", "x-vercel-forwarded-for", "x-forwarded-for"]) {
    const valor = h.get(nome)?.split(",")[0]?.trim();
    if (valor) return valor;
  }
  return "desconhecido";
}

export function mesmaOrigem(h: Headers): boolean {
  const origem = h.get("origin");
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!origem || !host) return false;
  const site = h.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  try {
    return new URL(origem).host === host.split(",")[0].trim();
  } catch {
    return false;
  }
}

// Lê o corpo com teto de bytes, mesmo sem Content-Length (envio em partes). null = grande demais.
async function lerCorpo(req: Request, limite: number): Promise<string | null> {
  const declarado = Number(req.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > limite) return null;
  if (!req.body) return "";
  const leitor = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel().catch(() => undefined);
      return null;
    }
    partes.push(value);
  }
  const tudo = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    tudo.set(p, pos);
    pos += p.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(tudo);
}

export function criarHandler(deps: DepsRota): (req: Request) => Promise<Response> {
  const agora = deps.agora ?? Date.now;
  const log = deps.log ?? ((linha: string) => console.log(linha));
  const processar = deps.processar;
  const contingencia = deps.contingencia ?? semContingencia;

  // Só exemplos prontos têm gravação; qualquer erro aqui desliga a contingência, sem derrubar a rota.
  async function gravada(c: CorpoAgente, motivo: MotivoContingencia) {
    try {
      return await contingencia(c, motivo);
    } catch {
      return null;
    }
  }

  function registrar(l: LinhaLog): void {
    try {
      log(JSON.stringify(l));
    } catch {
      // log nunca derruba a resposta
    }
  }

  return async function POST(req: Request): Promise<Response> {
    const inicio = agora();
    const ms = () => agora() - inicio;
    try {
      if (!mesmaOrigem(req.headers)) {
        registrar({ nivel: null, falha: "origem", ms: ms(), chamadas: 0, tentativasRedacao: 0 });
        return json({ erro: "origem não permitida" }, 403);
      }

      let texto: string | null;
      try {
        texto = await lerCorpo(req, LIMITE_CORPO_BYTES);
      } catch {
        texto = ""; // UTF-8 inválido ou leitura interrompida: cai na validação
      }
      if (texto === null) {
        registrar({ nivel: null, falha: "tamanho", ms: ms(), chamadas: 0, tentativasRedacao: 0 });
        return json({ erro: "mensagem grande demais" }, 413);
      }

      let bruto: unknown;
      try {
        bruto = JSON.parse(texto);
      } catch {
        bruto = undefined;
      }
      const corpo = CorpoAgente.safeParse(bruto);
      if (!corpo.success) {
        registrar({ nivel: null, falha: "entrada", ms: ms(), chamadas: 0, tentativasRedacao: 0 });
        return json({ erro: "entrada inválida" }, 400);
      }

      const ip = ipDaRequisicao(req.headers);
      const limite = consumirTodos([
        { limitador: deps.limites.ipMinuto, chave: ip, nome: "ip_minuto" },
        { limitador: deps.limites.ipDia, chave: ip, nome: "ip_dia" },
        { limitador: deps.limites.global, chave: "global", nome: "diario" },
      ]);
      if (!limite.ok) {
        // Reproduz o resultado gravado sem consumir cota nem chamar o proxy.
        const replay = await gravada(corpo.data, limite.nome as NomeLimite);
        if (replay) {
          registrar({ nivel: replay.nivel, falha: `gravada_${limite.nome}`, ms: ms(), chamadas: 0, tentativasRedacao: 0 });
          return json({ ...replay, modelo: replay.contingencia.modelo });
        }
        registrar({ nivel: null, falha: `limite_${limite.nome}`, ms: ms(), chamadas: 0, tentativasRedacao: 0 });
        return json(
          { erro: MENSAGEM_LIMITE, limite: limite.nome as NomeLimite, reiniciaEm: new Date(limite.reiniciaEm).toISOString() },
          429,
        );
      }

      const resultado: ResultadoPipeline = await processar(corpo.data);
      // Falha do provedor do modelo, ou classificação inválida mesmo após nova tentativa (json_invalido).
      const motivoFalha: MotivoContingencia | null =
        resultado.falha && FALHAS_COM_CONTINGENCIA.has(resultado.falha.tipo)
          ? (resultado.falha.tipo as MotivoContingencia)
          : !resultado.falha && !resultado.classificacaoValida
            ? "json_invalido"
            : null;
      if (motivoFalha) {
        const replay = await gravada(corpo.data, motivoFalha);
        if (replay) {
          registrar({ nivel: replay.nivel, falha: `gravada_${motivoFalha}`, ms: ms(), chamadas: resultado.chamadas.length, tentativasRedacao: resultado.tentativasRedacao });
          return json({ ...replay, modelo: replay.contingencia.modelo });
        }
      }
      registrar({ nivel: resultado.nivel, falha: resultado.falha?.tipo ?? null, ms: ms(), chamadas: resultado.chamadas.length, tentativasRedacao: resultado.tentativasRedacao });
      return json({ ...resultado, modelo: deps.modelo ?? null });
    } catch {
      const resultado = resultadoFalha("interno");
      registrar({ nivel: 2, falha: "interno", ms: ms(), chamadas: 0, tentativasRedacao: 0 });
      return json({ ...resultado, modelo: deps.modelo ?? null });
    }
  };
}
