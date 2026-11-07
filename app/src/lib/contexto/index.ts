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

// Pedido como estava em `agora`. Os dados trazem a posição de 02/11 08:00 (AGORA); para um momento
// anterior (simulação sobre o histórico), status, separação e entrega são reconstruídos pelas datas
// e pelos eventos do portal, sem olhar o futuro. Cancelamento e devolução não têm data nos dados:
// antes do corte, o pedido aparece como aguardando separação, em trânsito ou entregue.
export function pedidoNaData(p: Pedido, eventos: readonly EventoRastreio[], agora: string): Pedido {
  const t = instante(agora);
  if (t >= instante(AGORA)) return p;
  const eventoEntrega = eventos.find((e) => e.status === "entregue");
  const tEntrega = eventoEntrega ? instante(eventoEntrega.data_hora_evento) : p.data_entrega ? instante(p.data_entrega) : null;
  const entregue = tEntrega !== null && tEntrega <= t;
  const separado = p.data_separacao !== null && instante(p.data_separacao) <= t;
  const extraviado = eventos.some((e) => e.status === "extraviado" && instante(e.data_hora_evento) <= t);
  const status: StatusEntrega = entregue ? "entregue" : extraviado ? "extraviado" : separado ? "em_transito" : "aguardando_separacao";
  return {
    ...p,
    status_entrega: status,
    data_entrega: entregue ? p.data_entrega : null,
    data_separacao: separado ? p.data_separacao : null,
    cd_separacao: separado ? p.cd_separacao : null,
    maquina_personalizacao: separado ? p.maquina_personalizacao : null,
  };
}

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
    reenviosCliente12m: Campo<number | null>; // CRM (posição de 02/11)
    reenviosOms12m: Campo<number>; // OMS, 365 dias antes de agora
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
  const pedidoBruto = conversa.order_id ? (base.pedidos.find((p) => p.order_id === conversa.order_id) ?? null) : null;
  const orderId = pedidoBruto?.order_id ?? null;
  const itens = orderId ? base.itens.filter((i) => i.order_id === orderId) : [];
  const cliente = base.clientes.find((c) => c.customer_id === conversa.customer_id) ?? null;
  const portal = ORIGEM.portal(pedidoBruto?.transportadora ?? "da transportadora");

  // Rastreio (portal), só até agora
  const todosEventos = orderId
    ? base.rastreio.filter((r) => r.pedido_ref === orderId).sort((a, b) => instante(a.data_hora_evento) - instante(b.data_hora_evento))
    : [];
  const rastreio = todosEventos.filter((r) => instante(r.data_hora_evento) <= tAgora);
  const pedido = pedidoBruto ? pedidoNaData(pedidoBruto, todosEventos, agora) : null;
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
  const pagamentos = orderId ? base.pagamentos.filter((p) => p.order_id === orderId && instante(p.data_hora_criacao) <= tAgora) : [];
  const efetivadas = pagamentos.filter((p) => STATUS_COBRANCA_EFETIVADA.has(p.status));
  const estornos = orderId ? base.estornos.filter((e) => e.order_id === orderId && instante(e.data_hora_solicitacao) <= tAgora) : [];
  const duplicidade = efetivadas.length > 1;
  // O status do gateway é a posição de 02/11: antes disso, só vale o estorno registrado até agora.
  const naPosicaoDosDados = tAgora >= instante(AGORA);
  const jaEstornada =
    duplicidade &&
    ((naPosicaoDosDados && efetivadas.some((p) => p.status === "estornada" || p.valor_estornado > 0)) ||
      estornos.some((e) => e.status === "concluido" || e.status === "em_processamento"));

  // OMS
  const reenvios = base.trocas
    .filter((t) => t.customer_id === conversa.customer_id && instante(t.data_solicitacao) < tAgora)
    .sort((a, b) => instante(a.data_solicitacao) - instante(b.data_solicitacao));
  const trocasNoPedido = orderId ? reenvios.filter((t) => t.order_id_original === orderId && t.tipo === "troca").length : 0;
  const reenviosOms12m = reenvios.filter((t) => instante(t.data_solicitacao) >= tAgora - 365 * DIA_MS).length;

  // Chamados (portal) abertos em `agora`
  const chamadosAbertos = orderId
    ? base.chamados.filter(
        (c) =>
          c.order_id === orderId &&
          instante(c.data_abertura) <= tAgora &&
          (c.data_encerramento ? instante(c.data_encerramento) > tAgora : c.status !== "encerrado"),
      )
    : [];

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
      reenviosOms12m: campo(reenviosOms12m, ORIGEM.calculado(`${ORIGEM.oms}: solicitações nos 365 dias antes de agora`)),
      chamadosAbertos: campo(chamadosAbertos, portal),
      temFichaProduto: campo(temFicha, ORIGEM.catalogo),
    },
  };
}

// Fatos que o motor de política recebe. null quando a conversa não tem pedido.
// reenvios: "crm" usa clientes.n_trocas_12m (posição de 02/11); "oms" conta no OMS os 365 dias antes de
// agora, para a simulação sobre o histórico não enxergar trocas futuras.
export function fatosParaPolitica(ficha: Ficha, opcoes: { reenvios?: "crm" | "oms" } = {}): FatosPedido | null {
  const p = ficha.pedido.valor;
  if (!p) return null;
  const r = ficha.resumo;
  const reenvios = opcoes.reenvios === "oms" ? r.reenviosOms12m.valor : (r.reenviosCliente12m.valor ?? undefined);
  return {
    statusEntrega: p.status_entrega,
    valorPedido: p.valor,
    separado: p.data_separacao !== null,
    diasUteisAtraso: r.diasUteisAtraso.valor ?? undefined,
    diasUteisSemAtualizacao: r.diasUteisSemAtualizacao.valor ?? undefined,
    diasDesdeRecebimento: r.diasDesdeRecebimento.valor ?? undefined,
    temFoto: ficha.anexos.valor.length > 0,
    reenviosCliente12m: reenvios,
    duplicidadeConfirmadaGateway: r.duplicidade.valor,
    duplicidadeJaEstornada: r.duplicidadeJaEstornada.valor,
    temFichaProduto: r.temFichaProduto.valor,
    trocasNoPedido: r.trocasNoPedido.valor,
  };
}
