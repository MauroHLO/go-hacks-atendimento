// Visão única do pedido (docs/decisoes.md, seção 3).
// Junta numa ficha só o que o atendente hoje busca em sistemas separados, com a origem de cada campo:
// ERP (pedido, itens), portal da transportadora (rastreio, chamados), gateway (pagamentos, estornos),
// OMS (trocas e reenvios), CRM (cliente) e central de atendimento (conversa, mensagens, anexos).

import {
  AGORA,
  BASE,
  dia,
  instante,
  type Anexo,
  type Base,
  type Chamado,
  type Cliente,
  type Conversa,
  type Estorno,
  type EventoRastreio,
  type Item,
  type Mensagem,
  type Pagamento,
  type Pedido,
  type TrocaReenvio,
} from "../dados";
import { diasUteisEntre, type FatosPedido, type StatusEntrega } from "../policy";

export const ORIGEM = {
  atendimento: "Central de atendimento",
  erp: "ERP de pedidos",
  gateway: "Gateway de pagamentos",
  oms: "OMS de trocas e reenvios",
  crm: "CRM",
  catalogo: "Catálogo (PIM)",
  portal: (transportadora: string) => `Portal ${transportadora}`,
  calculado: (de: string) => `Calculado (${de})`,
} as const;

export interface Campo<T> {
  valor: T;
  origem: string;
}

function campo<T>(valor: T, origem: string): Campo<T> {
  return { valor, origem };
}

export const STATUS_COBRANCA_EFETIVADA: ReadonlySet<Pagamento["status"]> = new Set(["capturada", "paga", "estornada"]);
const DIA_MS = 86_400_000;

export interface Ficha {
  conversa: Campo<Conversa>;
  mensagens: Campo<Mensagem[]>;
  anexos: Campo<Anexo[]>;
  pedido: Campo<Pedido | null>;
  itens: Campo<Item[]>;
  cliente: Campo<Cliente | null>;
  rastreio: Campo<EventoRastreio[]>;
  resumo: {
    statusEntrega: Campo<StatusEntrega | null>;
    dataSeparacao: Campo<string | null>;
    dataEntrega: Campo<string | null>;
    dataPrometida: Campo<string | null>;
    diasUteisAtraso: Campo<number | null>; // 0 = dentro do prazo
    diasDesdeRecebimento: Campo<number | null>;
    ultimoEventoRastreio: Campo<EventoRastreio | null>;
    diasUteisSemAtualizacao: Campo<number | null>; // só para pedido ainda não entregue
    cobrancasEfetivadas: Campo<Pagamento[]>;
    duplicidade: Campo<boolean>;
    duplicidadeJaEstornada: Campo<boolean>;
    estornos: Campo<Estorno[]>;
    reenviosAnteriores: Campo<TrocaReenvio[]>; // do cliente, em qualquer pedido
    trocasNoPedido: Campo<number>;
    reenviosCliente12m: Campo<number | null>;
    chamadosAbertos: Campo<Chamado[]>;
    temFichaProduto: Campo<boolean>;
  };
}

// Ficha da conversa. null se a conversa não existe na base.
export function montarContexto(conversationId: string, base: Base = BASE, agora: string = AGORA): Ficha | null {
  const conversa = base.conversas.find((c) => c.conversation_id === conversationId);
  if (!conversa) return null;
  const tAgora = instante(agora);
  const hoje = dia(agora);

  const mensagens = base.mensagens
    .filter((m) => m.conversation_id === conversationId)
    .sort((a, b) => instante(a.timestamp) - instante(b.timestamp));
  const anexos = base.anexos.filter((a) => a.conversation_id === conversationId);
  const pedido = conversa.order_id ? (base.pedidos.find((p) => p.order_id === conversa.order_id) ?? null) : null;
  const orderId = pedido?.order_id ?? null;
  const itens = orderId ? base.itens.filter((i) => i.order_id === orderId) : [];
  const cliente = base.clientes.find((c) => c.customer_id === conversa.customer_id) ?? null;
  const portal = ORIGEM.portal(pedido?.transportadora ?? "da transportadora");

  // Rastreio (portal)
  const rastreio = orderId
    ? base.rastreio.filter((r) => r.pedido_ref === orderId).sort((a, b) => instante(a.data_hora_evento) - instante(b.data_hora_evento))
    : [];
  const ultimo = rastreio.at(-1) ?? null;
  const naoEntregue = pedido !== null && pedido.status_entrega !== "entregue" && !pedido.data_entrega;
  const semAtualizacao = ultimo && naoEntregue ? diasUteisEntre(dia(ultimo.data_hora_evento), hoje) : null;

  // Prazo (ERP + calendário de feriados de parametros.md)
  let atraso: number | null = null;
  if (pedido?.data_prometida) {
    atraso = diasUteisEntre(pedido.data_prometida, pedido.data_entrega ?? hoje);
  }
  const desdeRecebimento = pedido?.data_entrega ? Math.floor((tAgora - instante(pedido.data_entrega)) / DIA_MS) : null;

  // Gateway
  const pagamentos = orderId ? base.pagamentos.filter((p) => p.order_id === orderId) : [];
  const efetivadas = pagamentos.filter((p) => STATUS_COBRANCA_EFETIVADA.has(p.status));
  const estornos = orderId ? base.estornos.filter((e) => e.order_id === orderId) : [];
  const duplicidade = efetivadas.length > 1;
  const jaEstornada =
    duplicidade &&
    (efetivadas.some((p) => p.status === "estornada" || p.valor_estornado > 0) || estornos.some((e) => e.status === "concluido"));

  // OMS
  const reenvios = base.trocas
    .filter((t) => t.customer_id === conversa.customer_id && instante(t.data_solicitacao) < tAgora)
    .sort((a, b) => instante(a.data_solicitacao) - instante(b.data_solicitacao));
  const trocasNoPedido = orderId ? reenvios.filter((t) => t.order_id_original === orderId && t.tipo === "troca").length : 0;

  // Chamados (portal)
  const chamadosAbertos = orderId ? base.chamados.filter((c) => c.order_id === orderId && c.status !== "encerrado") : [];

  const temFicha = pedido ? base.produtos.some((p) => p.sku === pedido.sku) : false;

  return {
    conversa: campo(conversa, ORIGEM.atendimento),
    mensagens: campo(mensagens, ORIGEM.atendimento),
    anexos: campo(anexos, ORIGEM.atendimento),
    pedido: campo(pedido, ORIGEM.erp),
    itens: campo(itens, ORIGEM.erp),
    cliente: campo(cliente, ORIGEM.crm),
    rastreio: campo(rastreio, portal),
    resumo: {
      statusEntrega: campo(pedido?.status_entrega ?? null, ORIGEM.erp),
      dataSeparacao: campo(pedido?.data_separacao ?? null, ORIGEM.erp),
      dataEntrega: campo(pedido?.data_entrega ?? null, ORIGEM.erp),
      dataPrometida: campo(pedido?.data_prometida ?? null, ORIGEM.erp),
      diasUteisAtraso: campo(atraso, ORIGEM.calculado("ERP: data prometida e entrega; feriados de parametros.md")),
      diasDesdeRecebimento: campo(desdeRecebimento, ORIGEM.calculado("ERP: data de entrega")),
      ultimoEventoRastreio: campo(ultimo, portal),
      diasUteisSemAtualizacao: campo(semAtualizacao, ORIGEM.calculado(`${portal}: último evento; feriados de parametros.md`)),
      cobrancasEfetivadas: campo(efetivadas, ORIGEM.gateway),
      duplicidade: campo(duplicidade, ORIGEM.calculado(`${ORIGEM.gateway}: mais de uma cobrança capturada, paga ou estornada`)),
      duplicidadeJaEstornada: campo(jaEstornada, ORIGEM.calculado(ORIGEM.gateway)),
      estornos: campo(estornos, ORIGEM.gateway),
      reenviosAnteriores: campo(reenvios, ORIGEM.oms),
      trocasNoPedido: campo(trocasNoPedido, ORIGEM.oms),
      reenviosCliente12m: campo(cliente?.n_trocas_12m ?? null, ORIGEM.crm),
      chamadosAbertos: campo(chamadosAbertos, portal),
      temFichaProduto: campo(temFicha, ORIGEM.catalogo),
    },
  };
}

// Fatos que o motor de política recebe. null quando a conversa não tem pedido.
export function fatosParaPolitica(ficha: Ficha): FatosPedido | null {
  const p = ficha.pedido.valor;
  if (!p) return null;
  const r = ficha.resumo;
  return {
    statusEntrega: p.status_entrega,
    valorPedido: p.valor,
    separado: p.data_separacao !== null,
    diasUteisAtraso: r.diasUteisAtraso.valor ?? undefined,
    diasUteisSemAtualizacao: r.diasUteisSemAtualizacao.valor ?? undefined,
    diasDesdeRecebimento: r.diasDesdeRecebimento.valor ?? undefined,
    temFoto: ficha.anexos.valor.length > 0,
    reenviosCliente12m: r.reenviosCliente12m.valor ?? undefined,
    duplicidadeConfirmadaGateway: r.duplicidade.valor,
    duplicidadeJaEstornada: r.duplicidadeJaEstornada.valor,
    temFichaProduto: r.temFichaProduto.valor,
    trocasNoPedido: r.trocasNoPedido.valor,
  };
}
