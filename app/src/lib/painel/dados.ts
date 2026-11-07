// Dados da interface, montados no servidor a partir de data/processed (copiados para app/src/dados/processados
// por npm run copiar-dados) e da base da fila (app/src/dados). Tudo serializável para os componentes do cliente.
// Cada número leva a fonte (arquivo e script que o gera). Nenhum texto escrito pelo cliente.

import anexosConferidos from "../../dados/processados/anexos_conferidos.json";
import avaliacao from "../../dados/processados/avaliacao_jev.json";
import casosDemo from "../../dados/processados/casos_demo.json";
import filaConversas from "../../dados/processados/fila_conversas.json";
import filaResultado from "../../dados/processados/fila_resultado.json";
import metricas from "../../dados/processados/metricas.json";
import simulacao from "../../dados/processados/simulacao_autonomia.json";
import { detectarIncidentes, type Incidente } from "../agent/analista";
import type { Resumo } from "../agent/resumo";
import { montarContexto, type Ficha } from "../contexto";
import { AGORA, BASE } from "../dados";
import { Simulador } from "../ferramentas";
import { CENARIO_PADRAO } from "../policy";
import { REVISAO_MANUAL_JEV, type RevisaoManualJev } from "./revisao";

// ---------- formatação ----------
export function dataBr(d: string | null | undefined): string {
  if (!d) return "—";
  const [a, m, di] = d.slice(0, 10).split("-");
  return `${di}/${m}/${a}${d.length > 10 ? ` ${d.slice(11, 16)}` : ""}`;
}
export function reais(v: number, casas = 2): string {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}`;
}
export function num(v: number, casas = 0): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// ---------- ficha ----------
export interface LinhaFicha {
  campo: string;
  valor: string;
  origem: string;
}

const STATUS_TXT: Record<string, string> = {
  aguardando_separacao: "aguardando separação",
  em_transito: "em trânsito",
  entregue: "entregue",
  extraviado: "extraviado",
  devolvido: "devolvido",
  cancelado: "cancelado",
};

export function linhasDaFicha(f: Ficha): LinhaFicha[] {
  const c = f.conversa.valor;
  const p = f.pedido.valor;
  const r = f.resumo;
  const sn = (b: boolean) => (b ? "sim" : "não");
  const linhas: LinhaFicha[] = [
    { campo: "Conversa", valor: `${c.conversation_id} · ${c.canal} · ${c.marca} · aberta em ${dataBr(c.data_abertura)}`, origem: f.conversa.origem },
  ];
  if (p) {
    linhas.push(
      { campo: "Pedido", valor: `${p.order_id} · ${reais(p.valor)} · ${p.forma_pagamento ?? "—"}`, origem: f.pedido.origem },
      { campo: "Produto", valor: p.descricao_produto, origem: f.pedido.origem },
      { campo: "Itens", valor: f.itens.valor.map((i) => `${i.quantidade}× ${i.descricao}`).join("; ") || "—", origem: f.itens.origem },
      { campo: "Transportadora", valor: `${p.transportadora} · ${p.uf}`, origem: f.pedido.origem },
      { campo: "Status da entrega", valor: STATUS_TXT[r.statusEntrega.valor ?? ""] ?? "—", origem: r.statusEntrega.origem },
      { campo: "Separação", valor: dataBr(r.dataSeparacao.valor), origem: r.dataSeparacao.origem },
      { campo: "Data prometida", valor: dataBr(r.dataPrometida.valor), origem: r.dataPrometida.origem },
      { campo: "Entrega", valor: dataBr(r.dataEntrega.valor), origem: r.dataEntrega.origem },
      { campo: "Dias úteis de atraso", valor: r.diasUteisAtraso.valor === null ? "—" : String(r.diasUteisAtraso.valor), origem: r.diasUteisAtraso.origem },
      { campo: "Dias desde o recebimento", valor: r.diasDesdeRecebimento.valor === null ? "—" : String(r.diasDesdeRecebimento.valor), origem: r.diasDesdeRecebimento.origem },
      {
        campo: "Último evento do rastreio",
        valor: r.ultimoEventoRastreio.valor ? `${r.ultimoEventoRastreio.valor.status.replaceAll("_", " ")} em ${dataBr(r.ultimoEventoRastreio.valor.data_hora_evento)}` : "—",
        origem: r.ultimoEventoRastreio.origem,
      },
      { campo: "Dias úteis sem atualização", valor: r.diasUteisSemAtualizacao.valor === null ? "—" : String(r.diasUteisSemAtualizacao.valor), origem: r.diasUteisSemAtualizacao.origem },
      {
        campo: "Cobranças efetivadas",
        valor: r.cobrancasEfetivadas.valor.length ? r.cobrancasEfetivadas.valor.map((x) => `${reais(x.valor)} (${x.status})`).join("; ") : "nenhuma",
        origem: r.cobrancasEfetivadas.origem,
      },
      { campo: "Cobrança em dobro", valor: `${sn(r.duplicidade.valor)}${r.duplicidade.valor ? `; já estornada: ${sn(r.duplicidadeJaEstornada.valor)}` : ""}`, origem: r.duplicidade.origem },
      { campo: "Estornos", valor: String(r.estornos.valor.length), origem: r.estornos.origem },
      { campo: "Trocas neste pedido", valor: String(r.trocasNoPedido.valor), origem: r.trocasNoPedido.origem },
      { campo: "Chamados abertos com a transportadora", valor: r.chamadosAbertos.valor.length ? r.chamadosAbertos.valor.map((x) => `${x.chamado_id} (${x.motivo.replaceAll("_", " ")})`).join("; ") : "nenhum", origem: r.chamadosAbertos.origem },
      { campo: "Ficha do produto no catálogo", valor: sn(r.temFichaProduto.valor), origem: r.temFichaProduto.origem },
    );
  } else {
    linhas.push({ campo: "Pedido", valor: "conversa sem pedido associado", origem: f.pedido.origem });
  }
  const cli = f.cliente.valor;
  linhas.push(
    { campo: "Reenvios do cliente em 12 meses (OMS)", valor: String(r.reenviosOms12m.valor), origem: r.reenviosOms12m.origem },
    { campo: "Cliente", valor: cli ? `${cli.segmento} · ${cli.n_pedidos} pedidos` : "—", origem: f.cliente.origem },
    { campo: "Aceita aviso", valor: cli ? `WhatsApp: ${cli.aceita_comunicacao_whatsapp}; e-mail: ${cli.aceita_comunicacao_email}` : "—", origem: f.cliente.origem },
    { campo: "Anexos", valor: String(f.anexos.valor.length), origem: f.anexos.origem },
  );
  return linhas;
}

// ---------- tipos da interface ----------
export interface ItemFila {
  id: string;
  canal: string;
  marca: string;
  idadeH: number | null;
  slaMin: number | null;
  slaRestanteMin: number | null;
  slaEstourado: boolean;
  caso: Resumo;
  ficha: LinhaFicha[];
}

export interface CasoDemo {
  tipo: string;
  descricao: string;
  momento: string;
  tag: string;
  caso: Resumo;
  ficha: LinhaFicha[];
}

type Res = (typeof simulacao.resultados)[number];

export interface DadosPainel {
  agora: string;
  visao: {
    problema: { rotulo: string; valor: string; detalhe: string; fonte: string }[];
    resultado: {
      semPessoa: { vigente: number; nova: number; vigenteTodas: number; novaTodas: number; semDemanda: number };
      sozinho: { vigente: number; nova: number };
      horas: { vigente: number; nova: number };
      sinalizadosMes: number;
      sinalizadosAmostra: number;
      fonte: string;
    };
  };
  fila: { itens: ItemFila[]; sumario: typeof filaResultado.sumario; fonte: string };
  casos: CasoDemo[];
  analista: { incidentes: Incidente[]; avisosHoje: number; limiteDia: number; fonte: string };
  autonomia: {
    cenarios: { nome: string; rotulo: string; n0: number; n1: number; n2: number; semPessoa: number; semPessoaTodas: number; horas: number; saldo: number; saldoComparavel: number }[];
    ganho: (typeof simulacao.ganho_incremental_p005)[number][];
    faixaP: Res[];
    padrao: Res;
    rotulos: Record<string, string>;
    fonte: string;
  };
  conferencia: {
    jev: {
      n: number;
      concordancia: number;
      porTag: { tag: string; n: number; concordancia: number }[];
      confiancaDiscordantes: Record<string, number>;
      confiancaConcordantes: Record<string, number>;
      desencontros: { conversation_id: string; tag: string; motivo_jev: string; confianca: number }[];
      revisao: RevisaoManualJev;
      chamadas: number;
      falhas429: number;
      invalidas: number;
      custoUsd: number;
    };
    anexos: typeof anexosConferidos.anexos;
    fonte: string;
  };
  conversasTeste: { id: string; canal: string; marca: string; motivo: string }[];
}

export const ROTULO_CENARIO: Record<string, string> = {
  "1_vigente": "1. Vigente",
  "2_base_ajustada": "2. Base ajustada",
  "3_cancelamento_antes_separacao": "3. + Cancelamento antes da separação",
  "4_atraso_comprovado": "4. + Atraso comprovado",
  "5_troca_fragrancia": "5. + Troca de fragrância",
  "6_reclame_aqui_separa": "6. + Reclame Aqui separa ação e resposta",
  "7_freio_3000": "7. + Freio de R$ 3.000/dia (padrão)",
  "8_padrao_motivo_jev": "8. Padrão com o motivo do Jev",
};

const FONTE_METRICAS = "data/processed/metricas.json (analysis/analise_atendimento.py), amostra de 1 em 4 × 4";
const FONTE_SIM = "data/processed/simulacao_autonomia.json (npm run simular), p = 0,05, mês = amostra × 4 ÷ 3";

function linhasCasoDemo(f: Record<string, unknown>): LinhaFicha[] {
  const nome: Record<string, string> = {
    status_entrega: "Status da entrega",
    data_entrega: "Entrega",
    dias_desde_recebimento: "Dias desde o recebimento",
    reenvios_cliente_12m: "Reenvios do cliente em 12 meses",
  };
  const linhas: LinhaFicha[] = [{ campo: "Pedido", valor: String(f.order_id), origem: "ERP de pedidos" }];
  for (const [k, v] of Object.entries(f)) {
    if (v && typeof v === "object" && "valor" in v) {
      const c = v as { valor: unknown; origem: string };
      linhas.push({ campo: nome[k] ?? k, valor: k === "status_entrega" ? (STATUS_TXT[String(c.valor)] ?? String(c.valor)) : k.startsWith("data") ? dataBr(String(c.valor)) : String(c.valor), origem: c.origem });
    }
  }
  linhas.push({ campo: "Anexos", valor: String(f.anexos), origem: "Central de atendimento (anexos)" });
  return linhas;
}

export function montarPainel(): DadosPainel {
  const vc = metricas.volume_custo;
  const res = simulacao.resultados;
  const em = (nome: string, p = 0.05) => res.find((r) => r.cenario === nome && r.p_sem_sinal === p)!;
  const vig = em("1_vigente");
  const pad = em("7_freio_3000");

  // Fila: ordem de prioridade = SLA estourado primeiro, depois menor SLA restante.
  const sla = new Map(filaConversas.map((c) => [c.conversation_id, c]));
  const itens: ItemFila[] = (filaResultado.conversas as unknown as Resumo[]).map((caso) => {
    const s = sla.get(caso.conversation_id);
    const ficha = montarContexto(caso.conversation_id, BASE, AGORA)!;
    return {
      id: caso.conversation_id,
      canal: caso.canal,
      marca: ficha.conversa.valor.marca,
      idadeH: (s?.idade_h as number | null) ?? null,
      slaMin: (s?.sla_min as number | null) ?? null,
      slaRestanteMin: (s?.sla_restante_min as number | null) ?? null,
      slaEstourado: s?.sla_estourado === true,
      caso,
      ficha: linhasDaFicha(ficha),
    };
  });
  const chave = (i: ItemFila) => (i.slaEstourado ? -1e9 : (i.slaRestanteMin ?? 1e9));
  itens.sort((a, b) => chave(a) - chave(b) || (b.idadeH ?? 0) - (a.idadeH ?? 0));

  const casos: CasoDemo[] = (casosDemo.casos as unknown as (Resumo & { tipo: string; descricao: string; momento_da_decisao: string; tag_agente: string; ficha: Record<string, unknown> })[]).map((c) => {
    const { tipo, descricao, momento_da_decisao, tag_agente, ficha, ...caso } = c;
    return { tipo, descricao, momento: momento_da_decisao, tag: tag_agente, caso: caso as unknown as Resumo, ficha: linhasCasoDemo(ficha) };
  });

  const analista = detectarIncidentes({ sim: new Simulador({ papel: "analista", cenario: CENARIO_PADRAO }) });
  const avisosHoje = analista.incidentes.flatMap((i) => i.avisos).filter((a) => a.executado).reduce((s, a) => s + a.pedidos, 0);

  const nomes = [...Object.keys(ROTULO_CENARIO)];
  const cenarios = nomes
    .map((n) => res.find((r) => r.cenario === n && r.p_sem_sinal === 0.05))
    .filter((r): r is Res => !!r)
    .map((r) => ({
      nome: r.cenario,
      rotulo: ROTULO_CENARIO[r.cenario],
      n0: r.pct_nivel0,
      n1: r.pct_nivel1,
      n2: r.pct_nivel2,
      semPessoa: r.pct_autonomas_com_demanda,
      semPessoaTodas: r.pct_autonomas,
      horas: r.horas_mes_liberadas,
      saldo: r.saldo_liquido_mes_rs,
      saldoComparavel: r.saldo_comparavel_mes_rs,
    }));

  const am = avaliacao.amostra;
  return {
    agora: AGORA,
    visao: {
      problema: [
        { rotulo: "conversas por mês", valor: num(vc.conversas_por_mes.escalado_x4), detalhe: `${num(vc.conversas.amostra)} conversas em 90 dias na amostra`, fonte: FONTE_METRICAS },
        { rotulo: "custo de atendimento por mês", valor: reais(vc.custo_por_mes_rs.escalado_x4, 0), detalhe: "custo por conversa do canal (parametros.md)", fonte: FONTE_METRICAS },
        { rotulo: "horas de atendimento por mês", valor: num(vc.horas_trabalhadas_por_mes.escalado_x4, 1).replace(",0", ""), detalhe: `${num(vc.minutos_trabalhados_medio, 1)} min por conversa, em média`, fonte: FONTE_METRICAS },
        { rotulo: "das conversas com pedido são recontato", valor: `${num(metricas.recontato.pct_conversas_com_pedido_em_recontato, 1)}%`, detalhe: `${num(metricas.recontato.pedidos_com_recontato)} pedidos com mais de uma conversa na amostra`, fonte: FONTE_METRICAS },
      ],
      resultado: {
        semPessoa: { vigente: vig.pct_autonomas_com_demanda, nova: pad.pct_autonomas_com_demanda, vigenteTodas: vig.pct_autonomas, novaTodas: pad.pct_autonomas, semDemanda: pad.sem_demanda },
        sozinho: { vigente: vig.pct_nivel0, nova: pad.pct_nivel0 },
        horas: { vigente: vig.horas_mes_liberadas, nova: pad.horas_mes_liberadas },
        sinalizadosMes: Math.round((pad.casos_sinal_forte * 4) / 3),
        sinalizadosAmostra: pad.casos_sinal_forte,
        fonte: FONTE_SIM,
      },
    },
    fila: { itens, sumario: filaResultado.sumario, fonte: "data/processed/fila_resultado.json (npm run processar-fila, AI Proxy real, 02/11 08:00)" },
    casos,
    analista: { incidentes: analista.incidentes, avisosHoje, limiteDia: 300, fonte: "lib/agent/analista.ts sobre app/src/dados/agregados.json (data/processed) e pedidos_afetados.json" },
    autonomia: {
      cenarios,
      ganho: simulacao.ganho_incremental_p005,
      faixaP: [0.02, 0.05, 0.1].map((p) => em("7_freio_3000", p)),
      padrao: pad,
      rotulos: ROTULO_CENARIO,
      fonte: FONTE_SIM,
    },
    conferencia: {
      jev: {
        n: am.n,
        concordancia: am.concordancia_tag,
        porTag: Object.entries(am.concordancia_por_tag).map(([tag, v]) => ({ tag, n: v.n, concordancia: v.concordancia_tag })),
        confiancaDiscordantes: am.confianca_discordantes,
        confiancaConcordantes: am.confianca_concordantes,
        desencontros: am.desencontros_para_revisao,
        revisao: REVISAO_MANUAL_JEV,
        chamadas: avaliacao.chamadas,
        falhas429: avaliacao.falhas_primeira_passada.total,
        invalidas: avaliacao.invalidas_depois_da_nova_tentativa,
        custoUsd: avaliacao.custo_usd,
      },
      anexos: anexosConferidos.anexos,
      fonte: "data/processed/avaliacao_jev.json (npm run avaliar-jev) e anexos_conferidos.json (npm run anexos-conferidos)",
    },
    conversasTeste: itens.map((i) => ({ id: i.id, canal: i.canal, marca: i.marca, motivo: i.caso.classificacao.motivo })),
  };
}
