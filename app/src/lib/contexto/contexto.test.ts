import { describe, expect, it } from "vitest";
import { BASE, baseVazia, type Base, type Pedido } from "../dados";
import { decidirNivel } from "../policy";
import { fatosParaPolitica, montarContexto, pedidoNaData } from "./index";

// ---------- base fictícia ----------

function pedido(p: Partial<Pedido> = {}): Pedido {
  return {
    order_id: "GBH900001",
    customer_id: "CH900001",
    marca: "Kokeshi",
    data_pedido: "2026-10-20",
    valor: 129.9,
    sku: "KSH-TESTE",
    descricao_produto: "Sérum Teste 30ml",
    personalizacao: null,
    transportadora: "Expressa Já",
    uf: "BA",
    status_entrega: "em_transito",
    data_separacao: "2026-10-21 10:00:00",
    cd_separacao: "CD1",
    maquina_personalizacao: null,
    data_entrega: null,
    lote_produto: "LT2610-A",
    data_prometida: "2026-10-27",
    codigo_rastreio: "EJ000000000BR",
    forma_pagamento: "cartao",
    cupom: null,
    ...p,
  };
}

function base(parcial: Partial<Base> = {}, ped: Partial<Pedido> = {}): Base {
  return baseVazia({
    conversas: [
      { conversation_id: "AT900001", customer_id: "CH900001", order_id: "GBH900001", marca: "Kokeshi", canal: "whatsapp", status: "aberto", data_abertura: "2026-11-01 21:00:00", n_interacoes: 2, atendente_id: null, data_primeira_resposta: null, assunto: null },
      { conversation_id: "AT900002", customer_id: "CH900002", order_id: null, marca: "Gocase", canal: "email", status: "aberto", data_abertura: "2026-11-01 22:00:00", n_interacoes: 1, atendente_id: null, data_primeira_resposta: null, assunto: "Dúvida" },
    ],
    mensagens: [
      { conversation_id: "AT900001", message_id: "M2", autor: "cliente", timestamp: "2026-11-01 21:05:00", texto: "Cadê meu pedido?" },
      { conversation_id: "AT900001", message_id: "M1", autor: "bot", timestamp: "2026-11-01 21:00:00", texto: "Olá!" },
    ],
    pedidos: [pedido(ped)],
    itens: [{ item_id: "GBH900001-1", order_id: "GBH900001", sku: "KSH-TESTE", descricao: "Sérum Teste 30ml", tipo_item: "venda", quantidade: 1, valor_total: 129.9, personalizacao: null, texto_personalizacao: null, lote: "LT2610-A" }],
    rastreio: [
      { portal: "Expressa Já", pedido_ref: "GBH900001", data_hora_evento: "2026-10-22 09:00", status: "em_transferencia", local: "CD", previsao_entrega: "2026-10-27", codigo_rastreio: "EJ000000000BR" },
      { portal: "Expressa Já", pedido_ref: "GBH900001", data_hora_evento: "2026-10-21 15:00", status: "coletado", local: "CD1", previsao_entrega: "2026-10-27", codigo_rastreio: "EJ000000000BR" },
    ],
    clientes: [{ customer_id: "CH900001", segmento: "recorrente", n_pedidos: 3, receita_acumulada: 400, n_trocas_12m: 2, aceita_comunicacao_whatsapp: "sim", aceita_comunicacao_email: "não" }],
    produtos: [{ sku: "KSH-TESTE", nome: "Sérum Teste 30ml", marca: "Kokeshi", categoria: "Skincare" }],
    ...parcial,
  });
}

// ---------- testes ----------

describe("montarContexto", () => {
  it("conversa inexistente: null", () => {
    expect(montarContexto("AT000000", base())).toBeNull();
  });

  it("junta as fontes e marca a origem de cada campo", () => {
    const f = montarContexto("AT900001", base())!;
    expect(f.pedido).toMatchObject({ origem: "ERP de pedidos", valor: { order_id: "GBH900001" } });
    expect(f.cliente.origem).toBe("CRM");
    expect(f.rastreio.origem).toBe("Portal Expressa Já");
    expect(f.resumo.cobrancasEfetivadas.origem).toBe("Gateway de pagamentos");
    expect(f.resumo.reenviosAnteriores.origem).toBe("OMS de trocas e reenvios");
    expect(f.resumo.reenviosCliente12m).toEqual({ valor: 2, origem: "CRM" });
    expect(f.resumo.diasUteisAtraso.origem).toContain("feriados de parametros.md");
    // mensagens e eventos em ordem cronológica
    expect(f.mensagens.valor.map((m) => m.message_id)).toEqual(["M1", "M2"]);
    expect(f.resumo.ultimoEventoRastreio.valor?.status).toBe("em_transferencia");
  });

  it("dias úteis de atraso e de rastreio parado contam o feriado de 02/11", () => {
    // prometido 27/10 (ter); agora 02/11 (seg, feriado): 28, 29, 30/10 = 3 dias úteis
    // último evento 22/10 (qui): 23, 26, 27, 28, 29, 30/10 = 6 dias úteis
    const f = montarContexto("AT900001", base())!;
    expect(f.resumo.diasUteisAtraso.valor).toBe(3);
    expect(f.resumo.diasUteisSemAtualizacao.valor).toBe(6);
  });

  it("pedido entregue: atraso pela data de entrega, sem 'rastreio parado' e com dias desde o recebimento", () => {
    const f = montarContexto("AT900001", base({}, { status_entrega: "entregue", data_entrega: "2026-10-29" }))!;
    expect(f.resumo.diasUteisAtraso.valor).toBe(2); // 28 e 29/10
    expect(f.resumo.diasUteisSemAtualizacao.valor).toBeNull();
    expect(f.resumo.diasDesdeRecebimento.valor).toBe(4);
  });

  it("entregue antes do prometido: atraso 0", () => {
    const f = montarContexto("AT900001", base({}, { status_entrega: "entregue", data_entrega: "2026-10-24" }))!;
    expect(f.resumo.diasUteisAtraso.valor).toBe(0);
  });

  it("cobrança duplicada: efetivadas, já estornada e estornos", () => {
    const pag = (id: string, status: "paga" | "capturada" | "estornada" | "recusada", estornado = 0) => ({
      transacao_id: id, order_id: "GBH900001", metodo: "cartao", status, valor: 129.9, valor_estornado: estornado, data_hora_criacao: "2026-10-20 10:00:00",
    });
    const sem = montarContexto("AT900001", base({ pagamentos: [pag("T1", "capturada"), pag("T2", "capturada"), pag("T3", "recusada")] }))!;
    expect(sem.resumo.cobrancasEfetivadas.valor).toHaveLength(2);
    expect(sem.resumo.duplicidade.valor).toBe(true);
    expect(sem.resumo.duplicidadeJaEstornada.valor).toBe(false);
    const com = montarContexto("AT900001", base({ pagamentos: [pag("T1", "capturada"), pag("T2", "estornada", 129.9)] }))!;
    expect(com.resumo.duplicidadeJaEstornada.valor).toBe(true);
    const unica = montarContexto("AT900001", base({ pagamentos: [pag("T1", "paga")] }))!;
    expect(unica.resumo.duplicidade.valor).toBe(false);
  });

  it("reenvios anteriores do cliente, trocas no pedido e chamados abertos", () => {
    const troca = (id: string, tipo: "troca" | "reenvio", orderId: string, data: string) => ({
      solicitacao_id: id, customer_id: "CH900001", order_id_original: orderId, tipo, motivo_registrado: "x", data_solicitacao: data, status: "entregue", custo_total: 10,
    });
    const chamado = (id: string, status: string) => ({
      chamado_id: id, transportadora: "Expressa Já", order_id: "GBH900001", conversation_id: null, data_abertura: "2026-10-30 10:00:00",
      motivo: "rastreio_sem_atualizacao", prazo_resposta: null, status, resposta_transportadora: null, nova_previsao_entrega: null, data_encerramento: null,
    });
    const f = montarContexto(
      "AT900001",
      base({
        trocas: [troca("S1", "reenvio", "GBH800000", "2026-09-01 10:00:00"), troca("S2", "troca", "GBH900001", "2026-10-30 10:00:00"), troca("S3", "reenvio", "GBH900001", "2026-11-05 10:00:00")],
        chamados: [chamado("EXJ-1", "respondido"), chamado("EXJ-2", "encerrado")],
      }),
    )!;
    expect(f.resumo.reenviosAnteriores.valor.map((t) => t.solicitacao_id)).toEqual(["S1", "S2"]); // S3 é futuro
    expect(f.resumo.trocasNoPedido.valor).toBe(1);
    expect(f.resumo.chamadosAbertos.valor.map((c) => c.chamado_id)).toEqual(["EXJ-1"]);
  });

  it("conversa sem pedido: ficha sem pedido e sem fatos para a política", () => {
    const f = montarContexto("AT900002", base())!;
    expect(f.pedido.valor).toBeNull();
    expect(f.resumo.statusEntrega.valor).toBeNull();
    expect(fatosParaPolitica(f)).toBeNull();
  });
});

describe("fatosParaPolitica", () => {
  it("leva os fatos da ficha para o motor", () => {
    const fatos = fatosParaPolitica(montarContexto("AT900001", base())!)!;
    expect(fatos).toMatchObject({
      statusEntrega: "em_transito",
      valorPedido: 129.9,
      separado: true,
      diasUteisAtraso: 3,
      diasUteisSemAtualizacao: 6,
      temFoto: false,
      reenviosCliente12m: 2,
      duplicidadeConfirmadaGateway: false,
      temFichaProduto: true,
      trocasNoPedido: 0,
    });
    expect(fatos.diasDesdeRecebimento).toBeUndefined();
    expect(decidirNivel({ motivo: "rastreio", confiancaClassificador: 0.9, fatos, valorAcao: 0, canal: "whatsapp" }).ferramenta).toBe(
      "abrir_chamado_transportadora",
    );
  });
});

describe("dados reais exportados (fila de 02/11)", () => {
  it("todas as 65 conversas da fila montam a ficha e passam pelo motor sem erro", () => {
    expect(BASE.conversas).toHaveLength(65);
    for (const c of BASE.conversas) {
      const f = montarContexto(c.conversation_id)!;
      expect(f).not.toBeNull();
      const fatos = fatosParaPolitica(f);
      if (c.order_id) expect(fatos).not.toBeNull();
      if (fatos) {
        const d = decidirNivel({ motivo: "rastreio", confiancaClassificador: 0.9, fatos, valorAcao: 0, canal: c.canal });
        expect([0, 1, 2]).toContain(d.nivel);
      }
    }
  });
});

describe("contexto em outra data (simulação sobre o histórico)", () => {
  const eventos = [
    { portal: "Expressa Já", pedido_ref: "GBH900001", data_hora_evento: "2026-10-21 15:00", status: "coletado", local: "CD1", previsao_entrega: null, codigo_rastreio: null },
    { portal: "Expressa Já", pedido_ref: "GBH900001", data_hora_evento: "2026-10-29 10:00", status: "entregue", local: "BA", previsao_entrega: null, codigo_rastreio: null },
  ];
  const final = pedido({ status_entrega: "entregue", data_entrega: "2026-10-29", data_separacao: "2026-10-21 10:00:00", cd_separacao: "CD1" });

  it("na posição dos dados (02/11 08:00) o pedido fica como está", () => {
    expect(pedidoNaData(final, eventos, "2026-11-02 08:00:00")).toBe(final);
  });

  it("antes da separação: aguardando, sem separação e sem entrega", () => {
    expect(pedidoNaData(final, eventos, "2026-10-20 12:00:00")).toMatchObject({
      status_entrega: "aguardando_separacao",
      data_separacao: null,
      cd_separacao: null,
      data_entrega: null,
    });
  });

  it("separado e antes do evento de entrega: em trânsito", () => {
    expect(pedidoNaData(final, eventos, "2026-10-29 09:59:00")).toMatchObject({ status_entrega: "em_transito", data_entrega: null });
    expect(pedidoNaData(final, eventos, "2026-10-29 10:00:00")).toMatchObject({ status_entrega: "entregue", data_entrega: "2026-10-29" });
  });

  it("extravio só a partir do evento", () => {
    const ext = [...eventos.slice(0, 1), { ...eventos[0], data_hora_evento: "2026-10-25 08:00", status: "extraviado" }];
    const p = pedido({ status_entrega: "extraviado" });
    expect(pedidoNaData(p, ext, "2026-10-24 08:00:00").status_entrega).toBe("em_transito");
    expect(pedidoNaData(p, ext, "2026-10-26 08:00:00").status_entrega).toBe("extraviado");
  });

  it("a ficha não enxerga eventos, cobranças, estornos nem chamados do futuro", () => {
    const pag = (id: string, status: "capturada" | "estornada", criacao: string) => ({
      transacao_id: id, order_id: "GBH900001", metodo: "cartao", status, valor: 129.9, valor_estornado: status === "estornada" ? 129.9 : 0, data_hora_criacao: criacao,
    });
    const b = base({
      pagamentos: [pag("T1", "capturada", "2026-10-20 10:00:00"), pag("T2", "estornada", "2026-10-20 10:01:00")],
      estornos: [{ estorno_id: "E1", transacao_id: "T2", order_id: "GBH900001", valor: 129.9, motivo: "cobranca_indevida", status: "concluido", data_hora_solicitacao: "2026-10-28 10:00:00" }],
      chamados: [{ chamado_id: "EXJ-1", transportadora: "Expressa Já", order_id: "GBH900001", conversation_id: null, data_abertura: "2026-10-26 10:00:00", motivo: "x", prazo_resposta: null, status: "encerrado", resposta_transportadora: null, nova_previsao_entrega: null, data_encerramento: "2026-10-30 10:00:00" }],
    });
    const antes = montarContexto("AT900001", b, "2026-10-22 08:00:00")!;
    expect(antes.rastreio.valor.map((e) => e.status)).toEqual(["coletado"]);
    expect(antes.resumo.duplicidade.valor).toBe(true);
    expect(antes.resumo.duplicidadeJaEstornada.valor).toBe(false); // status "estornada" é da posição de 02/11
    expect(antes.resumo.chamadosAbertos.valor).toHaveLength(0);
    const depois = montarContexto("AT900001", b, "2026-10-29 12:00:00")!;
    expect(depois.resumo.duplicidadeJaEstornada.valor).toBe(true); // estorno registrado em 28/10
    expect(depois.resumo.chamadosAbertos.valor.map((c) => c.chamado_id)).toEqual(["EXJ-1"]); // encerrado só em 30/10
  });

  it("reenvios do cliente no OMS nos 365 dias antes de agora", () => {
    const t = (id: string, data: string) => ({
      solicitacao_id: id, customer_id: "CH900001", order_id_original: "GBH800000", tipo: "reenvio" as const, motivo_registrado: "x", data_solicitacao: data, status: "entregue", custo_total: 10,
    });
    const b = base({ trocas: [t("S0", "2025-09-01 10:00:00"), t("S1", "2026-03-01 10:00:00"), t("S2", "2026-10-01 10:00:00"), t("S3", "2026-11-01 10:00:00")] });
    const f = montarContexto("AT900001", b, "2026-10-15 12:00:00")!;
    expect(f.resumo.reenviosOms12m.valor).toBe(2); // S1 e S2; S0 tem mais de 365 dias, S3 é futuro
    expect(fatosParaPolitica(f, { reenvios: "oms" })!.reenviosCliente12m).toBe(2);
    expect(fatosParaPolitica(f)!.reenviosCliente12m).toBe(2); // CRM da base fictícia
  });
});
