// Ferramentas simuladas (docs/decisoes.md, seção 3).
// Uma função por ferramenta, com o mesmo nome de ferramentas.csv. Consultas leem os JSON de app/src/dados;
// ações NÃO têm efeito real: só registram no log, no formato de acoes_executadas_sistemas.csv.
// Toda chamada checa o papel e os limites de ferramentas.csv e recusa o que passa da alçada.

import { mascararPii } from "../pii";
import { AGORA, BASE, dia, type Base, type Pedido } from "../dados";
import { STATUS_COBRANCA_EFETIVADA } from "../contexto";
import { podeAprovar, type Papel, type Pessoa } from "../policy";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
// Mesmas colunas de acoes_executadas_sistemas.csv.
export interface RegistroAcao {
  acao_id: string;
  conversation_id: string | null;
  order_id: string | null;
  data_hora: string;
  sistema: string;
  acao: string;
  valor_rs: number | null;
  executado_por: string;
  aprovado_por: string | null;
  referencia_sistema: string | null;
}

export interface Aprovacao {
  aprovacao_id: string;
  acao: string;
  order_id: string | null;
  conversation_id: string | null;
  valor: number;
  justificativa: string;
  solicitado_por: string;
  status: "pendente" | "aprovada" | "rejeitada";
  decidido_por: string | null;
}

export interface Suspeita {
  referencia: string;
  conversation_id: string;
  order_id: string | null;
  sinais: string[];
  evidencias: string[];
  sinalizado_por: string;
  data_hora: string;
}

export interface MensagemEnviada {
  conversation_id: string;
  tipo: string; // ferramenta que gerou a mensagem
  texto: string | null;
  data_hora: string;
}

export type Resultado<T = unknown> =
  | { ok: true; dados?: T; registro?: RegistroAcao }
  | { ok: false; erro: string; precisaAprovacaoDe?: "supervisor" };

export const PRECISA_APROVACAO = "precisa aprovação de supervisor";
export const EXECUTADO_POR = "agente";

// Ações com dinheiro suspensas enquanto há suspeita aberta no pedido (ferramentas.csv › sinalizar_suspeita).
const SUSPENSAS_POR_SUSPEITA: ReadonlySet<string> = new Set(["reenviar_produto", "reimprimir_personalizacao", "trocar_produto", "reembolsar"]);

// ---------------------------------------------------------------------------
// Estado da simulação
// ---------------------------------------------------------------------------
export interface OpcoesSimulador {
  base?: Base;
  papel?: Papel; // papel com que o agente age (padrão: atendente)
  agora?: () => string; // "AAAA-MM-DD HH:MM:SS"
}

export class Simulador {
  readonly base: Base;
  readonly papel: Papel;
  readonly agora: () => string;
  readonly log: RegistroAcao[] = [];
  readonly aprovacoes = new Map<string, Aprovacao>();
  readonly suspeitas: Suspeita[] = [];
  readonly mensagens: MensagemEnviada[] = [];
  readonly notificacoesPorDia = new Map<string, number>();
  private seq = new Map<string, number>();

  constructor(o: OpcoesSimulador = {}) {
    this.base = o.base ?? BASE;
    this.papel = o.papel ?? "atendente";
    this.agora = o.agora ?? (() => AGORA);
  }

  get eu(): Pessoa {
    return { id: EXECUTADO_POR, papel: this.papel };
  }

  proximo(prefixo: string, digitos = 6): string {
    const n = (this.seq.get(prefixo) ?? 0) + 1;
    this.seq.set(prefixo, n);
    return `${prefixo}-SIM-${String(n).padStart(digitos, "0")}`;
  }

  pedido(orderId: string): Pedido | undefined {
    return this.base.pedidos.find((p) => p.order_id === orderId);
  }

  // Decisão do supervisor sobre uma aprovação pendente (aprovar_acao/rejeitar_acao, fora do agente).
  decidirAprovacao(aprovacaoId: string, supervisor: Pessoa, aprovar: boolean): Resultado<Aprovacao> {
    const a = this.aprovacoes.get(aprovacaoId);
    if (!a) return { ok: false, erro: `aprovação ${aprovacaoId} não encontrada` };
    if (a.status !== "pendente") return { ok: false, erro: `aprovação ${aprovacaoId} já foi decidida` };
    const pode = podeAprovar(supervisor, { id: a.solicitado_por, papel: this.papel });
    if (!pode.ok) return { ok: false, erro: pode.justificativa };
    a.status = aprovar ? "aprovada" : "rejeitada";
    a.decidido_por = supervisor.id;
    return { ok: true, dados: a };
  }
}

// ---------------------------------------------------------------------------
// Checagens comuns
// ---------------------------------------------------------------------------
interface Pedidos {
  valor?: number;
  order_id?: string | null;
  aprovacao_id?: string;
}

function definicao(sim: Simulador, ferramenta: string) {
  return sim.base.ferramentas.find((f) => f.ferramenta === ferramenta);
}

// Devolve erro, ou o id do supervisor que aprovou (quando houve aprovação), ou null.
function autorizar(sim: Simulador, ferramenta: string, p: Pedidos): { erro: Resultado<never> } | { aprovadoPor: string | null } {
  const def = definicao(sim, ferramenta);
  if (!def) return { erro: { ok: false, erro: `ferramenta desconhecida: ${ferramenta}` } };
  if (!def.papeis_permitidos.includes(sim.papel)) {
    return {
      erro: {
        ok: false,
        erro: `o papel "${sim.papel}" não pode usar ${ferramenta} (permitido: ${def.papeis_permitidos.join(", ")})`,
      },
    };
  }

  if (p.order_id && SUSPENSAS_POR_SUSPEITA.has(ferramenta) && sim.suspeitas.some((s) => s.order_id === p.order_id)) {
    return { erro: { ok: false, erro: `pedido ${p.order_id} com solicitação em análise pelo supervisor: ${ferramenta} suspenso até a decisão` } };
  }

  if (def.limites.somente_antes_da_separacao === true && p.order_id) {
    const ped = sim.pedido(p.order_id);
    if (!ped) return { erro: { ok: false, erro: `pedido ${p.order_id} não encontrado` } };
    if (ped.data_separacao !== null || ped.status_entrega !== "aguardando_separacao") {
      return { erro: { ok: false, erro: `${ferramenta} só antes da separação; pedido ${p.order_id} já separado (${ped.status_entrega})` } };
    }
  }

  const limite = def.limites.valor_max_sem_aprovacao_rs;
  if (typeof limite === "number" && p.valor !== undefined) {
    if (!Number.isFinite(p.valor) || p.valor < 0) return { erro: { ok: false, erro: `valor inválido: ${p.valor}` } };
    if (p.valor > limite) {
      const a = p.aprovacao_id ? sim.aprovacoes.get(p.aprovacao_id) : undefined;
      const valida =
        a && a.status === "aprovada" && a.acao === ferramenta && (a.order_id ?? null) === (p.order_id ?? null) && p.valor <= a.valor;
      if (!valida) {
        return {
          erro: {
            ok: false,
            erro: `${PRECISA_APROVACAO}: ${ferramenta} de R$ ${p.valor.toFixed(2)} acima do limite de R$ ${limite.toFixed(2)}`,
            precisaAprovacaoDe: "supervisor",
          },
        };
      }
      return { aprovadoPor: a.decidido_por };
    }
  }
  return { aprovadoPor: null };
}

function registrar(
  sim: Simulador,
  r: Omit<RegistroAcao, "acao_id" | "data_hora" | "executado_por" | "aprovado_por"> & { aprovado_por?: string | null },
): RegistroAcao {
  const registro: RegistroAcao = {
    acao_id: sim.proximo("AC"),
    conversation_id: r.conversation_id,
    order_id: r.order_id,
    data_hora: sim.agora(),
    sistema: r.sistema,
    acao: r.acao,
    valor_rs: r.valor_rs,
    executado_por: EXECUTADO_POR,
    aprovado_por: r.aprovado_por ?? null,
    referencia_sistema: r.referencia_sistema,
  };
  sim.log.push(registro);
  return registro;
}

function enviar(sim: Simulador, conversationId: string, tipo: string, texto: string | null): void {
  sim.mensagens.push({ conversation_id: conversationId, tipo, texto, data_hora: sim.agora() });
}

function portal(sim: Simulador, orderId: string): string {
  return `Portal ${sim.pedido(orderId)?.transportadora ?? "da transportadora"}`;
}

const SISTEMA = {
  atendimento: "Central de atendimento",
  erp: "ERP de pedidos",
  crm: "CRM",
  politicas: "Base de políticas",
  gateway: "Gateway de pagamentos",
  cupons: "Plataforma de cupons",
  oms: "OMS de trocas e reenvios",
  producao: "Sistema de produção Gocase",
  time: "Canal do time",
} as const;

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------
export function ler_conversa(sim: Simulador, p: { conversation_id: string }) {
  const a = autorizar(sim, "ler_conversa", {});
  if ("erro" in a) return a.erro;
  const conversa = sim.base.conversas.find((c) => c.conversation_id === p.conversation_id);
  if (!conversa) return { ok: false, erro: `conversa ${p.conversation_id} não encontrada` } as const;
  const mensagens = sim.base.mensagens.filter((m) => m.conversation_id === p.conversation_id);
  const registro = registrar(sim, { conversation_id: p.conversation_id, order_id: conversa.order_id, sistema: SISTEMA.atendimento, acao: "ler_conversa", valor_rs: null, referencia_sistema: null });
  return { ok: true, dados: { conversa, mensagens }, registro } as const;
}

export function consultar_pedido(sim: Simulador, p: { order_id: string; conversation_id?: string }) {
  const a = autorizar(sim, "consultar_pedido", {});
  if ("erro" in a) return a.erro;
  const pedido = sim.pedido(p.order_id);
  if (!pedido) return { ok: false, erro: `pedido ${p.order_id} não encontrado` } as const;
  const itens = sim.base.itens.filter((i) => i.order_id === p.order_id);
  const rastreio = sim.base.rastreio.filter((r) => r.pedido_ref === p.order_id);
  const registro = registrar(sim, { conversation_id: p.conversation_id ?? null, order_id: p.order_id, sistema: SISTEMA.erp, acao: "consultar_pedido", valor_rs: null, referencia_sistema: null });
  return { ok: true, dados: { pedido, itens, rastreio }, registro } as const;
}

export function consultar_cliente(sim: Simulador, p: { customer_id: string; conversation_id?: string }) {
  const a = autorizar(sim, "consultar_cliente", {});
  if ("erro" in a) return a.erro;
  const cliente = sim.base.clientes.find((c) => c.customer_id === p.customer_id);
  if (!cliente) return { ok: false, erro: `cliente ${p.customer_id} não encontrado` } as const;
  const registro = registrar(sim, { conversation_id: p.conversation_id ?? null, order_id: null, sistema: SISTEMA.crm, acao: "consultar_cliente", valor_rs: null, referencia_sistema: null });
  return { ok: true, dados: cliente, registro } as const;
}

export function consultar_politicas(sim: Simulador, p: { categoria?: string } = {}) {
  const a = autorizar(sim, "consultar_politicas", {});
  if ("erro" in a) return a.erro;
  const linhas = p.categoria
    ? sim.base.politicas.filter((l) => l.secao === p.categoria || (l.secao === "categorias" && l.regra.startsWith(`${p.categoria}.`)))
    : sim.base.politicas;
  if (linhas.length === 0) return { ok: false, erro: `categoria ${p.categoria} não encontrada em politicas.csv` } as const;
  const registro = registrar(sim, { conversation_id: null, order_id: null, sistema: SISTEMA.politicas, acao: "consultar_politicas", valor_rs: null, referencia_sistema: null });
  return { ok: true, dados: linhas, registro } as const;
}

export function ver_anexos(sim: Simulador, p: { conversation_id?: string; order_id?: string; hash_perceptual?: string }) {
  const a = autorizar(sim, "ver_anexos", {});
  if ("erro" in a) return a.erro;
  if (!p.conversation_id && !p.order_id && !p.hash_perceptual) {
    return { ok: false, erro: "informe conversation_id, order_id ou hash_perceptual" } as const;
  }
  const anexos = sim.base.anexos.filter(
    (x) =>
      (!p.conversation_id || x.conversation_id === p.conversation_id) &&
      (!p.order_id || x.order_id === p.order_id) &&
      (!p.hash_perceptual || x.hash_perceptual === p.hash_perceptual),
  );
  const ocorrencias = p.hash_perceptual ? (sim.base.indiceHash[p.hash_perceptual] ?? []) : [];
  const registro = registrar(sim, { conversation_id: p.conversation_id ?? null, order_id: p.order_id ?? null, sistema: SISTEMA.atendimento, acao: "ver_anexos", valor_rs: null, referencia_sistema: null });
  return { ok: true, dados: { anexos, ocorrencias }, registro } as const;
}

export function verificar_pagamento(sim: Simulador, p: { order_id: string; conversation_id?: string }) {
  const a = autorizar(sim, "verificar_pagamento", {});
  if ("erro" in a) return a.erro;
  const pagamentos = sim.base.pagamentos.filter((x) => x.order_id === p.order_id);
  const estornos = sim.base.estornos.filter((x) => x.order_id === p.order_id);
  const efetivadas = pagamentos.filter((x) => STATUS_COBRANCA_EFETIVADA.has(x.status));
  const registro = registrar(sim, { conversation_id: p.conversation_id ?? null, order_id: p.order_id, sistema: SISTEMA.gateway, acao: "verificar_pagamento", valor_rs: null, referencia_sistema: null });
  return { ok: true, dados: { pagamentos, estornos, cobrancasEfetivadas: efetivadas.length, duplicidade: efetivadas.length > 1 }, registro } as const;
}

// Responde com a regra e o motivo calculado pela plataforma de cupons (uso_cupons.motivo_recusa).
export function validar_cupom(sim: Simulador, p: { codigo: string; order_id?: string; conversation_id?: string }) {
  const a = autorizar(sim, "validar_cupom", {});
  if ("erro" in a) return a.erro;
  const codigo = p.codigo.trim().toUpperCase();
  const cupom = sim.base.cupons.find((c) => c.codigo === codigo) ?? null;
  const usos = sim.base.usoCupons.filter((u) => u.codigo === codigo && (!p.order_id || u.order_id === p.order_id));
  const motivo = !cupom ? "cupom inexistente" : (usos.find((u) => u.motivo_recusa)?.motivo_recusa ?? null);
  const registro = registrar(sim, { conversation_id: p.conversation_id ?? null, order_id: p.order_id ?? null, sistema: SISTEMA.cupons, acao: "validar_cupom", valor_rs: null, referencia_sistema: sim.proximo("USO") });
  return { ok: true, dados: { cupom, usos, motivo }, registro } as const;
}

// ---------------------------------------------------------------------------
// Ações (sem efeito real)
// ---------------------------------------------------------------------------
export function informar_status(sim: Simulador, p: { conversation_id: string; order_id: string }) {
  const a = autorizar(sim, "informar_status", {});
  if ("erro" in a) return a.erro;
  const pedido = sim.pedido(p.order_id);
  if (!pedido) return { ok: false, erro: `pedido ${p.order_id} não encontrado` } as const;
  const eventos = sim.base.rastreio.filter((r) => r.pedido_ref === p.order_id);
  const ultimo = eventos.at(-1) ?? null;
  const dados = {
    status: pedido.status_entrega,
    transportadora: pedido.transportadora,
    previsao: ultimo?.previsao_entrega ?? pedido.data_prometida,
    ultimoEvento: ultimo,
  };
  enviar(sim, p.conversation_id, "informar_status", null);
  const registro = registrar(sim, { conversation_id: p.conversation_id, order_id: p.order_id, sistema: portal(sim, p.order_id), acao: "informar_status", valor_rs: null, referencia_sistema: null });
  return { ok: true, dados, registro } as const;
}

export function abrir_chamado_transportadora(sim: Simulador, p: { order_id: string; motivo: string; conversation_id?: string }) {
  const a = autorizar(sim, "abrir_chamado_transportadora", { order_id: p.order_id });
  if ("erro" in a) return a.erro;
  const pedido = sim.pedido(p.order_id);
  if (!pedido) return { ok: false, erro: `pedido ${p.order_id} não encontrado` } as const;
  const aberto = sim.base.chamados.find((c) => c.order_id === p.order_id && c.status !== "encerrado");
  if (aberto) return { ok: false, erro: `já existe chamado aberto para o pedido: ${aberto.chamado_id}` } as const;
  const registro = registrar(sim, { conversation_id: p.conversation_id ?? null, order_id: p.order_id, sistema: portal(sim, p.order_id), acao: "abrir_chamado_transportadora", valor_rs: null, referencia_sistema: sim.proximo("CHM") });
  return { ok: true, registro } as const;
}

type AcaoValor = { conversation_id: string; order_id: string; valor: number; aprovacao_id?: string };

function acaoComValor(sim: Simulador, ferramenta: string, sistema: string, prefixo: string, p: AcaoValor): Resultado {
  const a = autorizar(sim, ferramenta, p);
  if ("erro" in a) return a.erro;
  if (!sim.pedido(p.order_id)) return { ok: false, erro: `pedido ${p.order_id} não encontrado` };
  const registro = registrar(sim, {
    conversation_id: p.conversation_id,
    order_id: p.order_id,
    sistema,
    acao: ferramenta,
    valor_rs: p.valor,
    aprovado_por: a.aprovadoPor,
    referencia_sistema: sim.proximo(prefixo),
  });
  return { ok: true, registro };
}

export function reenviar_produto(sim: Simulador, p: AcaoValor & { motivo: string }) {
  return acaoComValor(sim, "reenviar_produto", SISTEMA.oms, "OMS", p);
}

export function reimprimir_personalizacao(sim: Simulador, p: AcaoValor & { personalizacao_correta?: string }) {
  return acaoComValor(sim, "reimprimir_personalizacao", SISTEMA.producao, "OMS", p);
}

export function trocar_produto(sim: Simulador, p: AcaoValor & { sku_novo?: string }) {
  return acaoComValor(sim, "trocar_produto", SISTEMA.oms, "OMS", p);
}

export function reembolsar(sim: Simulador, p: AcaoValor & { motivo: string }) {
  return acaoComValor(sim, "reembolsar", SISTEMA.gateway, "EST", p);
}

export function cancelar_pedido(sim: Simulador, p: { conversation_id: string; order_id: string; motivo?: string }) {
  const a = autorizar(sim, "cancelar_pedido", { order_id: p.order_id });
  if ("erro" in a) return a.erro;
  const pedido = sim.pedido(p.order_id)!;
  const registro = registrar(sim, { conversation_id: p.conversation_id, order_id: p.order_id, sistema: SISTEMA.erp, acao: "cancelar_pedido", valor_rs: pedido.valor, referencia_sistema: sim.proximo("EST") });
  return { ok: true, registro } as const;
}

// O novo endereço não vai para o log (dado pessoal).
export function alterar_endereco(sim: Simulador, p: { conversation_id: string; order_id: string; novo_endereco: string }) {
  const a = autorizar(sim, "alterar_endereco", { order_id: p.order_id });
  if ("erro" in a) return a.erro;
  if (!p.novo_endereco.trim()) return { ok: false, erro: "novo_endereco vazio" } as const;
  const registro = registrar(sim, { conversation_id: p.conversation_id, order_id: p.order_id, sistema: SISTEMA.erp, acao: "alterar_endereco", valor_rs: null, referencia_sistema: null });
  return { ok: true, registro } as const;
}

export function solicitar_foto(sim: Simulador, p: { conversation_id: string; do_que?: string }) {
  const a = autorizar(sim, "solicitar_foto", {});
  if ("erro" in a) return a.erro;
  enviar(sim, p.conversation_id, "solicitar_foto", null);
  const registro = registrar(sim, { conversation_id: p.conversation_id, order_id: null, sistema: SISTEMA.atendimento, acao: "solicitar_foto", valor_rs: null, referencia_sistema: null });
  return { ok: true, registro } as const;
}

// Põe o caso na fila do supervisor e suspende reenvio, troca e reembolso do pedido. Não envia nada ao cliente.
export function sinalizar_suspeita(sim: Simulador, p: { conversation_id: string; order_id?: string; sinais?: string[]; evidencias: string[] }) {
  const a = autorizar(sim, "sinalizar_suspeita", {});
  if ("erro" in a) return a.erro;
  if (p.evidencias.length === 0) return { ok: false, erro: "sinalizar_suspeita exige evidências verificáveis" } as const;
  const referencia = sim.proximo("SUS");
  sim.suspeitas.push({
    referencia,
    conversation_id: p.conversation_id,
    order_id: p.order_id ?? null,
    sinais: p.sinais ?? [],
    evidencias: p.evidencias,
    sinalizado_por: EXECUTADO_POR,
    data_hora: sim.agora(),
  });
  const registro = registrar(sim, { conversation_id: p.conversation_id, order_id: p.order_id ?? null, sistema: SISTEMA.atendimento, acao: "sinalizar_suspeita", valor_rs: null, referencia_sistema: referencia });
  return { ok: true, registro } as const;
}

export function orientar_suspensao_uso(sim: Simulador, p: { conversation_id: string }) {
  const a = autorizar(sim, "orientar_suspensao_uso", {});
  if ("erro" in a) return a.erro;
  enviar(sim, p.conversation_id, "orientar_suspensao_uso", null);
  const registro = registrar(sim, { conversation_id: p.conversation_id, order_id: null, sistema: SISTEMA.atendimento, acao: "orientar_suspensao_uso", valor_rs: null, referencia_sistema: null });
  return { ok: true, registro } as const;
}

export function solicitar_aprovacao(
  sim: Simulador,
  p: { acao: string; order_id?: string; conversation_id?: string; valor: number; justificativa: string },
) {
  const a = autorizar(sim, "solicitar_aprovacao", {});
  if ("erro" in a) return a.erro;
  if (!definicao(sim, p.acao)) return { ok: false, erro: `ação desconhecida: ${p.acao}` } as const;
  if (!p.justificativa.trim()) return { ok: false, erro: "justificativa obrigatória" } as const;
  const aprovacao: Aprovacao = {
    aprovacao_id: sim.proximo("APR"),
    acao: p.acao,
    order_id: p.order_id ?? null,
    conversation_id: p.conversation_id ?? null,
    valor: p.valor,
    justificativa: p.justificativa,
    solicitado_por: EXECUTADO_POR,
    status: "pendente",
    decidido_por: null,
  };
  sim.aprovacoes.set(aprovacao.aprovacao_id, aprovacao);
  const registro = registrar(sim, { conversation_id: aprovacao.conversation_id, order_id: aprovacao.order_id, sistema: SISTEMA.atendimento, acao: "solicitar_aprovacao", valor_rs: p.valor, referencia_sistema: aprovacao.aprovacao_id });
  return { ok: true, dados: aprovacao, registro } as const;
}

export function negar_por_politica(sim: Simulador, p: { conversation_id: string; regra: string }) {
  const a = autorizar(sim, "negar_por_politica", {});
  if ("erro" in a) return a.erro;
  if (!p.regra.trim()) return { ok: false, erro: "negar_por_politica exige citar a regra" } as const;
  enviar(sim, p.conversation_id, "negar_por_politica", null);
  const registro = registrar(sim, { conversation_id: p.conversation_id, order_id: null, sistema: SISTEMA.atendimento, acao: "negar_por_politica", valor_rs: null, referencia_sistema: null });
  return { ok: true, registro } as const;
}

export function agradecer(sim: Simulador, p: { conversation_id: string }) {
  const a = autorizar(sim, "agradecer", {});
  if ("erro" in a) return a.erro;
  enviar(sim, p.conversation_id, "agradecer", null);
  const registro = registrar(sim, { conversation_id: p.conversation_id, order_id: null, sistema: SISTEMA.atendimento, acao: "agradecer", valor_rs: null, referencia_sistema: null });
  return { ok: true, registro } as const;
}

// Recusa texto com CPF, cartão, telefone ou e-mail (ferramentas.csv: não deve repetir CPF, cartão ou telefone).
export function responder_cliente(sim: Simulador, p: { conversation_id: string; texto: string }) {
  const a = autorizar(sim, "responder_cliente", {});
  if ("erro" in a) return a.erro;
  if (!p.texto.trim()) return { ok: false, erro: "texto vazio" } as const;
  if (mascararPii(p.texto) !== p.texto) return { ok: false, erro: "a resposta contém dado pessoal (CPF, cartão, telefone ou e-mail)" } as const;
  enviar(sim, p.conversation_id, "responder_cliente", p.texto);
  const registro = registrar(sim, { conversation_id: p.conversation_id, order_id: null, sistema: SISTEMA.atendimento, acao: "responder_cliente", valor_rs: null, referencia_sistema: null });
  return { ok: true, registro } as const;
}

export function encerrar_conversa(sim: Simulador, p: { conversation_id: string; motivo?: string }) {
  const a = autorizar(sim, "encerrar_conversa", {});
  if ("erro" in a) return a.erro;
  const registro = registrar(sim, { conversation_id: p.conversation_id, order_id: null, sistema: SISTEMA.atendimento, acao: "encerrar_conversa", valor_rs: null, referencia_sistema: null });
  return { ok: true, registro } as const;
}

export function abrir_incidente(sim: Simulador, p: { tipo: string; escopo: string; evidencias: string[] }) {
  const a = autorizar(sim, "abrir_incidente", {});
  if ("erro" in a) return a.erro;
  if (p.evidencias.length === 0) return { ok: false, erro: "abrir_incidente exige evidências" } as const;
  const registro = registrar(sim, { conversation_id: null, order_id: null, sistema: SISTEMA.atendimento, acao: "abrir_incidente", valor_rs: null, referencia_sistema: sim.proximo("INC") });
  return { ok: true, registro } as const;
}

// ferramentas.csv › notificar_clientes › max_por_dia (300), contado por pedido notificado no dia.
export function notificar_clientes(sim: Simulador, p: { order_ids: string[]; tipo_aviso: string; texto: string }) {
  const a = autorizar(sim, "notificar_clientes", {});
  if ("erro" in a) return a.erro;
  const max = definicao(sim, "notificar_clientes")!.limites.max_por_dia as number;
  const unicos = [...new Set(p.order_ids)];
  const hoje = dia(sim.agora());
  const usados = sim.notificacoesPorDia.get(hoje) ?? 0;
  if (usados + unicos.length > max) {
    return { ok: false, erro: `limite de ${max} notificações por dia: já foram ${usados} hoje, pedido de ${unicos.length}` } as const;
  }
  if (mascararPii(p.texto) !== p.texto) return { ok: false, erro: "o aviso contém dado pessoal" } as const;
  sim.notificacoesPorDia.set(hoje, usados + unicos.length);
  const registro = registrar(sim, { conversation_id: null, order_id: null, sistema: SISTEMA.atendimento, acao: "notificar_clientes", valor_rs: null, referencia_sistema: sim.proximo("NOT") });
  return { ok: true, dados: { notificados: unicos.length, restantesHoje: max - usados - unicos.length }, registro } as const;
}

export function acionar_pessoa(sim: Simulador, p: { area: string; assunto: string; contexto: string; urgencia?: string; conversation_id?: string }) {
  const a = autorizar(sim, "acionar_pessoa", {});
  if ("erro" in a) return a.erro;
  const registro = registrar(sim, { conversation_id: p.conversation_id ?? null, order_id: null, sistema: SISTEMA.time, acao: "acionar_pessoa", valor_rs: null, referencia_sistema: sim.proximo("ACI") });
  return { ok: true, registro } as const;
}

// Registro por nome, para o agente chamar pelo nome de ferramentas.csv.
export const FERRAMENTAS = {
  ler_conversa,
  consultar_pedido,
  consultar_cliente,
  consultar_politicas,
  ver_anexos,
  verificar_pagamento,
  validar_cupom,
  informar_status,
  abrir_chamado_transportadora,
  reenviar_produto,
  reimprimir_personalizacao,
  trocar_produto,
  reembolsar,
  cancelar_pedido,
  alterar_endereco,
  solicitar_foto,
  sinalizar_suspeita,
  orientar_suspensao_uso,
  solicitar_aprovacao,
  negar_por_politica,
  agradecer,
  responder_cliente,
  encerrar_conversa,
  abrir_incidente,
  notificar_clientes,
  acionar_pessoa,
} as const;
export type NomeFerramenta = keyof typeof FERRAMENTAS;
