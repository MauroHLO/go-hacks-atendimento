import { describe, expect, it } from "vitest";
import { BASE, baseVazia, type Anexo, type Base, type Conversa, type Pedido } from "../dados";
import { EXECUTADO_POR, Simulador } from "../ferramentas";
import { CENARIO_PADRAO, MENSAGEM_EM_ANALISE } from "../policy";
import { TEXTO_RESERVA } from "./checagem";
import { clienteFalso, respostaChat, respostaJev, type RespostaFalsa } from "./fetch-falso";
import { fatosTexto, novoEstado, processarConversa } from "./orquestrador";
import { montarContexto } from "../contexto";

// ---------- base fictícia ----------
const AGORA = "2026-11-02 09:00:00";

function pedido(id: string, p: Partial<Pedido> = {}): Pedido {
  return {
    order_id: id, customer_id: "CH900001", marca: "Kokeshi", data_pedido: "2026-10-20", valor: 99.9, sku: "KSH-TESTE",
    descricao_produto: "Sérum Teste 30ml", personalizacao: null, transportadora: "ViaLog", uf: "SP", status_entrega: "entregue",
    data_separacao: "2026-10-21 10:00:00", cd_separacao: "CD1", maquina_personalizacao: null, data_entrega: "2026-10-30",
    lote_produto: "LT2610-A", data_prometida: "2026-10-27", codigo_rastreio: "VL000", forma_pagamento: "cartao", cupom: null, ...p,
  };
}
function conversa(id: string, orderId: string | null, c: Partial<Conversa> = {}): Conversa {
  return { conversation_id: id, customer_id: "CH900001", order_id: orderId, marca: "Kokeshi", canal: "whatsapp", status: "aberto", data_abertura: "2026-11-01 21:00:00", n_interacoes: 2, atendente_id: null, data_primeira_resposta: null, assunto: null, ...c };
}
function anexo(id: string, conv: string, orderId: string, hash: string): Anexo {
  return { anexo_id: id, conversation_id: conv, message_id: null, order_id: orderId, customer_id: "CH900001", canal: "whatsapp", enviado_em: "2026-11-01 21:05:00", tipo: "foto_produto", hash_perceptual: hash, exif_data_captura: null, exif_modelo_camera: null, exif_software: null, descricao_visual: "Embalagem de Sérum Teste 30ml amassada e vazando." };
}

function base(): Base {
  return baseVazia({
    conversas: [
      conversa("AT1", "P1"),
      conversa("AT2", "P2"),
      conversa("AT3", "P3"),
      conversa("AT4", "P1"),
      conversa("AT5", "P1", { canal: "reclame_aqui" }),
      conversa("AT8", "P1"),
    ],
    mensagens: [
      ...["AT1", "AT2", "AT3", "AT4", "AT5"].map((c, i) => ({ conversation_id: c, message_id: `M${i}`, autor: "cliente" as const, timestamp: "2026-11-01 21:01:00", texto: `mensagem do cliente ${c}, CPF 123.456.789-00` })),
      { conversation_id: "AT8", message_id: "M8", autor: "bot" as const, timestamp: "2026-11-01 21:00:00", texto: "Olá! Estamos fora do horário." },
    ],
    pedidos: [pedido("P1", { cupom: "TESTE10", status_entrega: "em_transito", data_entrega: null }), pedido("P2"), pedido("P3")],
    itens: ["P1", "P2", "P3"].map((p) => ({ item_id: `${p}-1`, order_id: p, sku: "KSH-TESTE", descricao: "Sérum Teste 30ml", tipo_item: "venda" as const, quantidade: 1, valor_total: 99.9, personalizacao: null, texto_personalizacao: null, lote: null })),
    clientes: [{ customer_id: "CH900001", segmento: "novo", n_pedidos: 1, receita_acumulada: 100, n_trocas_12m: 0, aceita_comunicacao_whatsapp: "sim", aceita_comunicacao_email: "sim" }],
    anexos: [anexo("IMG2", "AT2", "P2", "aaaa"), anexo("IMG3", "AT3", "P3", "bbbb")],
    indiceHash: {
      aaaa: [{ anexo_id: "IMG2", order_id: "P2", customer_id: "CH900001" }],
      bbbb: [{ anexo_id: "IMG3", order_id: "P3", customer_id: "CH900001" }, { anexo_id: "IMG9", order_id: "P9", customer_id: "CH999999" }],
    },
    produtos: [{ sku: "KSH-TESTE", nome: "Sérum Teste 30ml", marca: "Kokeshi", categoria: "Skincare", modo_de_uso: "Aplicar à noite.", vegano: "sim" }],
    cupons: [{ codigo: "TESTE10" }],
    usoCupons: [{ uso_id: "U1", codigo: "TESTE10", order_id: "P1", customer_id: "CH900001", status: "recusado", motivo_recusa: "valor mínimo não atingido" }],
  });
}

async function rodar(conv: string, rotas: { jev?: RespostaFalsa[]; chat?: RespostaFalsa[] }) {
  const sim = new Simulador({ base: base(), cenario: CENARIO_PADRAO, agora: () => AGORA });
  const { ia, chamadas } = clienteFalso(rotas);
  const r = await processarConversa(conv, { sim, ia, estado: novoEstado(), relogio: () => 0 });
  return { r, sim, chamadas, ferramentas: r.acoes.map((a) => a.ferramenta) };
}

// ---------- testes ----------
describe("nível 0: executa, responde e encerra", () => {
  it("cupom: validar_cupom com o motivo da plataforma, responder_cliente e encerrar_conversa", async () => {
    const { r, ferramentas, sim } = await rodar("AT1", {
      jev: [{ json: respostaJev("cupom") }],
      chat: [{ json: respostaChat("O cupom TESTE10 não foi aplicado porque o valor mínimo não foi atingido.") }],
    });
    expect(ferramentas).toEqual(["ler_conversa", "consultar_pedido", "consultar_cliente", "ver_anexos", "validar_cupom", "responder_cliente", "encerrar_conversa"]);
    expect(r.decisao).toMatchObject({ nivel: 0, nivelFinal: 0, ferramenta: "validar_cupom" });
    expect(r.resposta).toMatchObject({ enviada: true, paraAprovacao: false, reserva: false });
    expect(sim.mensagens.at(-1)?.texto).toContain("TESTE10");
  });

  it("avaria com foto e sem sinal: reenviar_produto no nível 0", async () => {
    const { r, ferramentas } = await rodar("AT2", {
      jev: [{ json: respostaJev("avaria") }],
      chat: [{ json: respostaChat("Fizemos o reenvio sem custo do produto do pedido P2.") }],
    });
    expect(r.sinais?.sinais).toEqual([]);
    expect(ferramentas).toContain("reenviar_produto");
    expect(r.log.find((l) => l.acao === "reenviar_produto")).toMatchObject({ valor_rs: 99.9, executado_por: EXECUTADO_POR, sistema: "OMS de trocas e reenvios" });
    expect(r.resposta.enviada).toBe(true);
  });
});

describe("nível 2", () => {
  it("foto repetida de outro cliente: sinalizar_suspeita, só 'em análise' e sem chamar o redator", async () => {
    const { r, ferramentas, chamadas } = await rodar("AT3", { jev: [{ json: respostaJev("avaria") }] });
    expect(r.sinais?.sinais).toContain("hash_em_outro_pedido_ou_cliente");
    expect(r.decisao).toMatchObject({ nivel: 2, ferramenta: "sinalizar_suspeita" });
    expect(ferramentas).toContain("sinalizar_suspeita");
    expect(ferramentas).not.toContain("reenviar_produto");
    expect(r.resposta).toMatchObject({ texto: MENSAGEM_EM_ANALISE, enviada: true });
    expect(chamadas.filter((c) => c.url.endsWith("/chat/completions"))).toHaveLength(0);
  });

  it("reação adversa: orientar_suspensao_uso + acionar_pessoa; resposta para aprovação", async () => {
    const { r, ferramentas } = await rodar("AT4", {
      jev: [{ json: respostaJev("troca_fragrancia", { sinais: { reacao_adversa: 0.9 } }) }],
      chat: [{ json: respostaChat("Pare de usar o produto e procure atendimento médico se precisar. Uma pessoa da equipe de qualidade vai cuidar do caso.") }],
    });
    expect(r.decisao).toMatchObject({ motivo: "reacao_adversa", nivel: 2 });
    expect(ferramentas).toEqual(expect.arrayContaining(["orientar_suspensao_uso", "acionar_pessoa", "solicitar_aprovacao"]));
    expect(r.resposta).toMatchObject({ enviada: false, paraAprovacao: true });
  });

  it("falha do classificador: nível 2, acionar_pessoa, texto de reserva sem chamar o redator", async () => {
    const { r, ferramentas, chamadas } = await rodar("AT1", { jev: [{ status: 500 }] });
    expect(r.classificacao).toMatchObject({ valida: false, falha: "http" });
    expect(r.decisao).toMatchObject({ nivel: 2, acao: "falha_classificador" });
    expect(ferramentas).toContain("acionar_pessoa");
    expect(r.resposta).toMatchObject({ texto: TEXTO_RESERVA, enviada: false });
    expect(chamadas.filter((c) => c.url.endsWith("/chat/completions"))).toHaveLength(0);
  }, 10_000);
});

describe("nível 1 e aprovação", () => {
  it("confiança abaixo de 0,7: solicitar_aprovacao e rascunho", async () => {
    const { r, ferramentas } = await rodar("AT1", {
      jev: [{ json: respostaJev("cupom", { confianca: 0.6 }) }],
      chat: [{ json: respostaChat("Uma pessoa da equipe vai analisar o seu cupom.") }],
    });
    expect(r.decisao.nivel).toBe(1);
    expect(ferramentas).not.toContain("validar_cupom");
    expect(ferramentas.filter((f) => f === "solicitar_aprovacao")).toHaveLength(2); // ação e resposta
    expect(r.resposta.enviada).toBe(false);
  });

  it("Reclame Aqui: a ação sai no nível 0, a resposta pública vai para aprovação", async () => {
    const { r, ferramentas } = await rodar("AT5", {
      jev: [{ json: respostaJev("cupom") }],
      chat: [{ json: respostaChat("O cupom TESTE10 não foi aplicado porque o valor mínimo não foi atingido.") }],
    });
    expect(r.decisao).toMatchObject({ nivelAcao: 0, aprovacaoResposta: true });
    expect(ferramentas).toContain("validar_cupom");
    expect(ferramentas).not.toContain("responder_cliente");
    expect(r.resposta.paraAprovacao).toBe(true);
  });

  it("redação reprovada duas vezes no nível 0: ação feita, texto de reserva e resposta para aprovação (nível 1)", async () => {
    const { r, ferramentas } = await rodar("AT1", { jev: [{ json: respostaJev("cupom") }], chat: [{ json: respostaChat("Você ganhou 50% de desconto amanhã!") }] });
    expect(ferramentas).toContain("validar_cupom");
    expect(r.decisao).toMatchObject({ nivel: 0, nivelFinal: 1 });
    expect(r.decisao.ajustes[0]).toContain("redação reprovada");
    expect(r.resposta).toMatchObject({ texto: TEXTO_RESERVA, reserva: true, enviada: false });
  });

  it("conversa só com o bot: sem demanda, sem chamar o modelo, nível 0, encerra sem responder", async () => {
    const { r, chamadas, ferramentas } = await rodar("AT8", {});
    expect(r.classificacao.motivo).toBe("sem_demanda");
    expect(chamadas).toHaveLength(0);
    expect(r.decisao).toMatchObject({ nivel: 0, nivelFinal: 0, ferramenta: "encerrar_conversa" });
    expect(ferramentas).toContain("encerrar_conversa");
    expect(ferramentas).not.toContain("responder_cliente");
    expect(ferramentas).not.toContain("solicitar_aprovacao");
    expect(r.resposta).toMatchObject({ texto: "", enviada: false, paraAprovacao: false });
  });
});

describe("privacidade, log e telemetria", () => {
  it("nada do que vai ao proxy tem o CPF do cliente", async () => {
    const { chamadas } = await rodar("AT1", { jev: [{ json: respostaJev("cupom") }], chat: [{ json: respostaChat("O cupom TESTE10 não foi aplicado.") }] });
    for (const c of chamadas) expect(JSON.stringify(c.corpo)).not.toContain("123.456.789-00");
  });

  it("log só da conversa, no formato de acoes_executadas_sistemas; telemetria com tokens e custo do Jev", async () => {
    const { r } = await rodar("AT2", { jev: [{ json: respostaJev("avaria", { custo: 0.0001 }) }], chat: [{ json: respostaChat("Fizemos o reenvio sem custo do produto.") }] });
    expect(r.log.every((l) => l.conversation_id === "AT2" && l.executado_por === "agente")).toBe(true);
    expect(r.telemetria).toMatchObject({ jev: { tokensEntrada: 100, custoUsd: 0.0001 }, chat: { tokensEntrada: 50, custoUsd: null }, custoUsdEstimado: 0.0001 });
    expect(r.telemetria.sistemasAcessados).toBeGreaterThanOrEqual(3);
  });

  it("conversa inexistente: erro", async () => {
    await expect(rodar("AT000", { jev: [{ json: respostaJev("cupom") }] })).rejects.toThrow("não encontrada");
  });
});

describe("dados reais da fila (sem rede)", () => {
  it("as 65 conversas passam pelo orquestrador com o proxy simulado", async () => {
    const sim = new Simulador({ cenario: CENARIO_PADRAO });
    const { ia } = clienteFalso({ jev: [{ json: respostaJev("rastreio") }], chat: [{ json: respostaChat("Recebemos sua mensagem.") }] });
    const estado = novoEstado();
    for (const c of BASE.conversas) {
      const r = await processarConversa(c.conversation_id, { sim, ia, estado });
      expect([0, 1, 2]).toContain(r.decisao.nivelFinal);
    }
  });
});

describe("fatos para o redator: previsão vencida", () => {
  it("pedido não entregue com prazo vencido: diz que está atrasado, sem a data vencida", () => {
    const ficha = montarContexto("AT1", base(), AGORA)!;
    const f = fatosTexto(ficha, AGORA).join(" ");
    expect(f).toContain("o pedido está atrasado");
    expect(f).not.toContain("27/10/2026");
  });
  it("prazo ainda no futuro: a data prometida entra", () => {
    const ficha = montarContexto("AT1", base(), "2026-10-20 09:00:00")!;
    expect(fatosTexto(ficha, "2026-10-20 09:00:00").join(" ")).toContain("Data prometida de entrega: 27/10/2026");
  });
});
