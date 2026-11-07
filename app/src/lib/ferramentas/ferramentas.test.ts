import { describe, expect, it } from "vitest";
import { BASE, baseVazia, type Base, type Pedido } from "../dados";
import { CENARIO_PADRAO, CENARIO_VIGENTE } from "../policy";
import * as F from "./index";
import { EXECUTADO_POR, FERRAMENTAS, PRECISA_APROVACAO, Simulador } from "./index";

// ---------- base fictícia ----------

function pedido(id: string, p: Partial<Pedido> = {}): Pedido {
  return {
    order_id: id,
    customer_id: "CH900001",
    marca: "Gocase",
    data_pedido: "2026-10-25",
    valor: 250,
    sku: "GOC-TESTE",
    descricao_produto: "Copo Teste",
    personalizacao: null,
    transportadora: "ViaLog",
    uf: "SP",
    status_entrega: "em_transito",
    data_separacao: "2026-10-26 10:00:00",
    cd_separacao: "CD1",
    maquina_personalizacao: null,
    data_entrega: null,
    lote_produto: null,
    data_prometida: "2026-10-30",
    codigo_rastreio: "VL000",
    forma_pagamento: "cartao",
    cupom: null,
    ...p,
  };
}

function base(parcial: Partial<Base> = {}): Base {
  return baseVazia({
    conversas: [
      { conversation_id: "AT900001", customer_id: "CH900001", order_id: "GCH900001", marca: "Gocase", canal: "whatsapp", status: "aberto", data_abertura: "2026-11-01 21:00:00", n_interacoes: 1, atendente_id: null, data_primeira_resposta: null, assunto: null },
    ],
    mensagens: [{ conversation_id: "AT900001", message_id: "M1", autor: "cliente", timestamp: "2026-11-01 21:00:00", texto: "Olá" }],
    pedidos: [pedido("GCH900001"), pedido("GCH900002", { status_entrega: "aguardando_separacao", data_separacao: null, valor: 80 })],
    clientes: [{ customer_id: "CH900001", segmento: "novo", n_pedidos: 1, receita_acumulada: 250, n_trocas_12m: 0, aceita_comunicacao_whatsapp: "sim", aceita_comunicacao_email: "sim" }],
    pagamentos: [
      { transacao_id: "T1", order_id: "GCH900001", metodo: "cartao", status: "capturada", valor: 250, valor_estornado: 0, data_hora_criacao: "2026-10-25 10:00:00" },
      { transacao_id: "T2", order_id: "GCH900001", metodo: "cartao", status: "capturada", valor: 250, valor_estornado: 0, data_hora_criacao: "2026-10-25 10:01:00" },
    ],
    cupons: [{ codigo: "TESTE10" }],
    usoCupons: [{ uso_id: "U1", codigo: "TESTE10", order_id: "GCH900001", customer_id: "CH900001", status: "recusado", motivo_recusa: "valor mínimo não atingido" }],
    politicas: [
      { secao: "categorias", regra: "avaria_vazamento.regra", valor: "Reenvio sem custo mediante foto em até 7 dias do recebimento." },
      { secao: "categorias", regra: "atraso_entrega.regra", valor: "..." },
    ],
    ...parcial,
  });
}

function sim(papel: "atendente" | "analista" | "supervisor" = "atendente") {
  return new Simulador({ base: base(), papel, agora: () => "2026-11-02 09:00:00", cenario: CENARIO_VIGENTE });
}

const COLUNAS_LOG = ["acao_id", "conversation_id", "order_id", "data_hora", "sistema", "acao", "valor_rs", "executado_por", "aprovado_por", "referencia_sistema"];

// ---------- testes ----------

describe("catálogo", () => {
  it("uma função por ferramenta pedida, com o mesmo nome de ferramentas.csv", () => {
    const doCsv = new Set(BASE.ferramentas.map((f) => f.ferramenta));
    for (const nome of Object.keys(FERRAMENTAS)) expect(doCsv.has(nome)).toBe(true);
    expect(Object.keys(FERRAMENTAS)).toHaveLength(26);
  });
});

describe("log de ações", () => {
  it("formato de acoes_executadas_sistemas, executado_por = agente, referência simulada", () => {
    const s = sim();
    const r = F.reenviar_produto(s, { conversation_id: "AT900001", order_id: "GCH900001", valor: 120, motivo: "avaria" });
    expect(r.ok).toBe(true);
    expect(s.log).toHaveLength(1);
    expect(Object.keys(s.log[0])).toEqual(COLUNAS_LOG);
    expect(s.log[0]).toMatchObject({
      acao_id: "AC-SIM-000001",
      sistema: "OMS de trocas e reenvios",
      acao: "reenviar_produto",
      valor_rs: 120,
      executado_por: EXECUTADO_POR,
      aprovado_por: null,
      data_hora: "2026-11-02 09:00:00",
      referencia_sistema: "OMS-SIM-000001",
    });
  });

  it("consultas leem os dados e também ficam no log (como consultar_pedido no log real)", () => {
    const s = sim();
    const r = F.consultar_pedido(s, { order_id: "GCH900001" });
    expect(r.ok && r.dados?.pedido.order_id).toBe("GCH900001");
    expect(s.log[0]).toMatchObject({ sistema: "ERP de pedidos", acao: "consultar_pedido", valor_rs: null });
  });

  it("recusa não entra no log", () => {
    const s = sim();
    F.reembolsar(s, { conversation_id: "AT900001", order_id: "GCH900001", valor: 150, motivo: "x" });
    expect(s.log).toHaveLength(0);
  });
});

describe("papel (ferramentas.csv › papeis_permitidos)", () => {
  it("atendente não abre incidente nem notifica clientes; analista sim", () => {
    expect(F.abrir_incidente(sim(), { tipo: "transportadora", escopo: "Expressa Já BA", evidencias: ["62% de recontato"] })).toMatchObject({ ok: false });
    expect(F.notificar_clientes(sim(), { order_ids: ["GCH900001"], tipo_aviso: "atraso", texto: "Aviso" }).ok).toBe(false);
    expect(F.abrir_incidente(sim("analista"), { tipo: "transportadora", escopo: "Expressa Já BA", evidencias: ["62% de recontato"] }).ok).toBe(true);
  });

  it("analista não reenvia produto", () => {
    const r = F.reenviar_produto(sim("analista"), { conversation_id: "AT900001", order_id: "GCH900001", valor: 10, motivo: "x" });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.erro).toContain('papel "analista"');
  });
});

describe("limites (valor_max_sem_aprovacao_rs)", () => {
  it.each<[keyof typeof FERRAMENTAS, number]>([
    ["reenviar_produto", 200],
    ["reimprimir_personalizacao", 200],
    ["trocar_produto", 200],
    ["reembolsar", 100],
  ])("%s: R$ %s passa; um centavo acima precisa de supervisor", (nome, limite) => {
    const f = FERRAMENTAS[nome] as (s: Simulador, p: object) => F.Resultado;
    const p = { conversation_id: "AT900001", order_id: "GCH900001", motivo: "x" };
    expect(f(sim(), { ...p, valor: limite }).ok).toBe(true);
    const r = f(sim(), { ...p, valor: limite + 0.01 });
    expect(r).toMatchObject({ ok: false, precisaAprovacaoDe: "supervisor" });
    expect(!r.ok && r.erro).toContain(PRECISA_APROVACAO);
  });

  it("cenário padrão: reenvio até R$ 300 sem aprovação; reembolso comum continua R$ 100", () => {
    const s = new Simulador({ base: base(), cenario: CENARIO_PADRAO });
    expect(F.reenviar_produto(s, { conversation_id: "AT900001", order_id: "GCH900001", valor: 300, motivo: "avaria" }).ok).toBe(true);
    expect(F.reenviar_produto(s, { conversation_id: "AT900001", order_id: "GCH900001", valor: 300.01, motivo: "avaria" }).ok).toBe(false);
    expect(F.reembolsar(s, { conversation_id: "AT900001", order_id: "GCH900001", valor: 100.01, motivo: "atraso" }).ok).toBe(false);
  });

  it("cenário com estorno sem teto: duplicidade comprovada no gateway estorna acima de R$ 100", () => {
    const cen = { ...CENARIO_VIGENTE, estornoDuplicidadeSemTeto: true };
    const s = new Simulador({ base: base(), cenario: cen });
    expect(F.reembolsar(s, { conversation_id: "AT900001", order_id: "GCH900001", valor: 250, motivo: "cobranca_duplicada" }).ok).toBe(true);
    // pedido sem duplicidade no gateway: teto continua
    expect(F.reembolsar(s, { conversation_id: "AT900001", order_id: "GCH900002", valor: 250, motivo: "cobranca_duplicada" }).ok).toBe(false);
    // outro motivo: teto continua
    expect(F.reembolsar(s, { conversation_id: "AT900001", order_id: "GCH900001", valor: 250, motivo: "atraso" }).ok).toBe(false);
  });

  it("acima do limite com aprovação do supervisor: executa e registra quem aprovou", () => {
    const s = sim();
    const pedido = F.solicitar_aprovacao(s, { acao: "reembolsar", order_id: "GCH900001", conversation_id: "AT900001", valor: 250, justificativa: "cobrança duplicada confirmada" });
    const id = pedido.ok ? pedido.dados!.aprovacao_id : "";
    // ainda pendente: recusa
    expect(F.reembolsar(s, { conversation_id: "AT900001", order_id: "GCH900001", valor: 250, motivo: "duplicidade", aprovacao_id: id }).ok).toBe(false);
    expect(s.decidirAprovacao(id, { id: "supervisor_01", papel: "supervisor" }, true).ok).toBe(true);
    const r = F.reembolsar(s, { conversation_id: "AT900001", order_id: "GCH900001", valor: 250, motivo: "duplicidade", aprovacao_id: id });
    expect(r.ok).toBe(true);
    expect(s.log.at(-1)).toMatchObject({ acao: "reembolsar", aprovado_por: "supervisor_01", referencia_sistema: "EST-SIM-000001" });
  });

  it("aprovação não vale para valor maior, outra ação ou outro pedido", () => {
    const s = sim();
    const r = F.solicitar_aprovacao(s, { acao: "reembolsar", order_id: "GCH900001", valor: 150, justificativa: "x" });
    const id = r.ok ? r.dados!.aprovacao_id : "";
    s.decidirAprovacao(id, { id: "supervisor_01", papel: "supervisor" }, true);
    expect(F.reembolsar(s, { conversation_id: "AT900001", order_id: "GCH900001", valor: 150.01, motivo: "x", aprovacao_id: id }).ok).toBe(false);
    expect(F.reenviar_produto(s, { conversation_id: "AT900001", order_id: "GCH900001", valor: 250, motivo: "x", aprovacao_id: id }).ok).toBe(false);
    expect(F.reembolsar(s, { conversation_id: "AT900001", order_id: "GCH900002", valor: 150, motivo: "x", aprovacao_id: id }).ok).toBe(false);
  });

  it("aprovação rejeitada ou decidida por quem não é supervisor não vale", () => {
    const s = sim();
    const r = F.solicitar_aprovacao(s, { acao: "reembolsar", order_id: "GCH900001", valor: 150, justificativa: "x" });
    const id = r.ok ? r.dados!.aprovacao_id : "";
    expect(s.decidirAprovacao(id, { id: "atendente_03", papel: "atendente" }, true).ok).toBe(false);
    expect(s.decidirAprovacao(id, { id: "supervisor_02", papel: "supervisor" }, false).ok).toBe(true);
    expect(F.reembolsar(s, { conversation_id: "AT900001", order_id: "GCH900001", valor: 150, motivo: "x", aprovacao_id: id }).ok).toBe(false);
  });

  it("supervisor não aprova a própria ação", () => {
    const s = new Simulador({ base: base(), papel: "atendente", cenario: CENARIO_VIGENTE });
    const r = F.solicitar_aprovacao(s, { acao: "reembolsar", order_id: "GCH900001", valor: 150, justificativa: "x" });
    const id = r.ok ? r.dados!.aprovacao_id : "";
    const d = s.decidirAprovacao(id, { id: EXECUTADO_POR, papel: "supervisor" }, true);
    expect(d.ok).toBe(false);
  });

  it("valor negativo é recusado", () => {
    expect(F.reenviar_produto(sim(), { conversation_id: "AT900001", order_id: "GCH900001", valor: -1, motivo: "x" }).ok).toBe(false);
  });
});

describe("direito comprovado por sistema (sem teto, até o valor do pedido)", () => {
  const atrasado = pedido("GCH900003", { data_prometida: "2026-10-15", valor: 420 }); // 11 dias úteis até 02/11
  const noPrazo = pedido("GCH900004", { data_prometida: "2026-10-30", valor: 420 });
  const extraviado = pedido("GCH900005", { status_entrega: "extraviado", valor: 380 });
  const naoSeparado = pedido("GCH900006", { status_entrega: "aguardando_separacao", data_separacao: null, valor: 640 });
  const b = () => base({ pedidos: [atrasado, noPrazo, extraviado, naoSeparado, pedido("GCH900001")] });
  const s = (cenario = CENARIO_PADRAO) => new Simulador({ base: b(), cenario, agora: () => "2026-11-02 09:00:00" });
  const p = (order_id: string, valor: number, motivo: string) => ({ conversation_id: "AT900001", order_id, valor, motivo });

  it("atraso > 7 dias úteis: reenvio e reembolso sem teto até o valor do pedido", () => {
    expect(F.reenviar_produto(s(), p("GCH900003", 420, "atraso")).ok).toBe(true);
    expect(F.reembolsar(s(), p("GCH900003", 420, "atraso")).ok).toBe(true);
    const acima = F.reembolsar(s(), p("GCH900003", 420.01, "atraso"));
    expect(acima).toMatchObject({ ok: false, precisaAprovacaoDe: "supervisor" });
  });

  it("extravio: sem teto", () => {
    expect(F.reembolsar(s(), p("GCH900005", 380, "atraso")).ok).toBe(true);
  });

  it("atraso não comprovado nos dados: vale o teto do atendente, mesmo com o motivo declarado", () => {
    expect(F.reembolsar(s(), p("GCH900004", 420, "atraso")).ok).toBe(false);
    expect(F.reembolsar(s(), p("GCH900004", 100, "atraso")).ok).toBe(true);
  });

  it("cancelamento antes da separação: cancelar_pedido + reembolso integral sem teto", () => {
    const sim = s();
    expect(F.cancelar_pedido(sim, { conversation_id: "AT900001", order_id: "GCH900006" }).ok).toBe(true);
    expect(F.reembolsar(sim, p("GCH900006", 640, "cancelamento")).ok).toBe(true);
    expect(F.reembolsar(s(), p("GCH900001", 250, "cancelamento")).ok).toBe(false); // já separado: teto de R$ 100
  });

  it("cenário vigente: as mesmas ações voltam ao teto do atendente", () => {
    expect(F.reembolsar(s(CENARIO_VIGENTE), p("GCH900003", 420, "atraso")).ok).toBe(false);
    expect(F.reembolsar(s(CENARIO_VIGENTE), p("GCH900006", 640, "cancelamento")).ok).toBe(false);
  });

  it("troca com coleta reversa: o novo item fica aguardando a conferência do CD", () => {
    const r = F.trocar_produto(s(), { conversation_id: "AT900001", order_id: "GCH900001", valor: 150, coleta_reversa: true });
    expect(r).toMatchObject({ ok: true, dados: { coletaReversa: true, envioNovoItem: F.ENVIO_CONDICIONADO_CD } });
    expect(F.trocar_produto(s(), { conversation_id: "AT900001", order_id: "GCH900001", valor: 200.01, coleta_reversa: true }).ok).toBe(false);
  });
});

describe("somente antes da separação", () => {
  it("cancelar e alterar endereço: aceitos antes, recusados depois da separação", () => {
    expect(F.cancelar_pedido(sim(), { conversation_id: "AT900001", order_id: "GCH900002" })).toMatchObject({ ok: true, registro: { valor_rs: 80 } });
    expect(F.alterar_endereco(sim(), { conversation_id: "AT900001", order_id: "GCH900002", novo_endereco: "Rua Fictícia, 1" }).ok).toBe(true);
    const r = F.cancelar_pedido(sim(), { conversation_id: "AT900001", order_id: "GCH900001" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.erro).toContain("só antes da separação");
    expect(F.alterar_endereco(sim(), { conversation_id: "AT900001", order_id: "GCH900001", novo_endereco: "Rua Fictícia, 1" }).ok).toBe(false);
  });

  it("o novo endereço não vai para o log", () => {
    const s = sim();
    F.alterar_endereco(s, { conversation_id: "AT900001", order_id: "GCH900002", novo_endereco: "Rua Fictícia, 123" });
    expect(JSON.stringify(s.log)).not.toContain("Fictícia");
  });
});

describe("suspeita", () => {
  it("sinalizar suspende reenvio, troca e reembolso do pedido e não envia nada ao cliente", () => {
    const s = sim();
    const r = F.sinalizar_suspeita(s, { conversation_id: "AT900001", order_id: "GCH900001", sinais: ["exif_antes_da_entrega"], evidencias: ["Foto IMG-T1: EXIF de 27/10, entrega 28/10."] });
    expect(r.ok).toBe(true);
    expect(s.mensagens).toHaveLength(0);
    expect(s.suspeitas[0]).toMatchObject({ order_id: "GCH900001", sinalizado_por: EXECUTADO_POR });
    const reenvio = F.reenviar_produto(s, { conversation_id: "AT900001", order_id: "GCH900001", valor: 50, motivo: "avaria" });
    expect(!reenvio.ok && reenvio.erro).toContain("em análise");
    expect(F.reembolsar(s, { conversation_id: "AT900001", order_id: "GCH900001", valor: 50, motivo: "x" }).ok).toBe(false);
    // outro pedido segue normal
    expect(F.reenviar_produto(s, { conversation_id: "AT900001", order_id: "GCH900002", valor: 50, motivo: "avaria" }).ok).toBe(true);
  });

  it("sem evidência não sinaliza", () => {
    expect(F.sinalizar_suspeita(sim(), { conversation_id: "AT900001", evidencias: [] }).ok).toBe(false);
  });
});

describe("mensagens ao cliente", () => {
  it("responder_cliente recusa CPF, cartão, telefone e e-mail", () => {
    for (const texto of ["Seu CPF 123.456.789-00 confere", "Cartão 1234 5678 9012 3456", "Ligue (11) 91234-5678", "Escreva para a@b.com"]) {
      expect(F.responder_cliente(sim(), { conversation_id: "AT900001", texto }).ok).toBe(false);
    }
    const s = sim();
    expect(F.responder_cliente(s, { conversation_id: "AT900001", texto: "Seu pedido está a caminho." }).ok).toBe(true);
    expect(s.mensagens[0]).toMatchObject({ tipo: "responder_cliente", texto: "Seu pedido está a caminho." });
  });

  it("negar_por_politica exige citar a regra", () => {
    expect(F.negar_por_politica(sim(), { conversation_id: "AT900001", regra: " " }).ok).toBe(false);
    expect(F.negar_por_politica(sim(), { conversation_id: "AT900001", regra: "alteracao_endereco.regra" }).ok).toBe(true);
  });

  it("solicitar_foto, agradecer, orientar_suspensao_uso e informar_status registram a mensagem", () => {
    const s = sim();
    F.solicitar_foto(s, { conversation_id: "AT900001" });
    F.agradecer(s, { conversation_id: "AT900001" });
    F.orientar_suspensao_uso(s, { conversation_id: "AT900001" });
    const st = F.informar_status(s, { conversation_id: "AT900001", order_id: "GCH900001" });
    expect(st.ok && st.dados).toMatchObject({ status: "em_transito", transportadora: "ViaLog", previsao: "2026-10-30" });
    expect(s.mensagens.map((m) => m.tipo)).toEqual(["solicitar_foto", "agradecer", "orientar_suspensao_uso", "informar_status"]);
    expect(s.log.at(-1)).toMatchObject({ sistema: "Portal ViaLog" });
  });
});

describe("consultas", () => {
  it("verificar_pagamento mostra a duplicidade", () => {
    const r = F.verificar_pagamento(sim(), { order_id: "GCH900001" });
    expect(r.ok && r.dados).toMatchObject({ cobrancasEfetivadas: 2, duplicidade: true });
  });

  it("validar_cupom devolve o motivo da plataforma", () => {
    const r = F.validar_cupom(sim(), { codigo: "teste10", order_id: "GCH900001" });
    expect(r.ok && r.dados?.motivo).toBe("valor mínimo não atingido");
    const x = F.validar_cupom(sim(), { codigo: "NAOEXISTE" });
    expect(x.ok && x.dados?.motivo).toBe("cupom inexistente");
  });

  it("consultar_politicas filtra pela categoria", () => {
    const r = F.consultar_politicas(sim(), { categoria: "avaria_vazamento" });
    expect(r.ok && r.dados).toHaveLength(1);
    expect(F.consultar_politicas(sim(), { categoria: "inexistente" }).ok).toBe(false);
  });

  it("ler_conversa, consultar_cliente e ver_anexos", () => {
    const s = sim();
    expect(F.ler_conversa(s, { conversation_id: "AT900001" }).ok).toBe(true);
    expect(F.ler_conversa(s, { conversation_id: "AT000000" }).ok).toBe(false);
    expect(F.consultar_cliente(s, { customer_id: "CH900001" }).ok).toBe(true);
    expect(F.ver_anexos(s, {}).ok).toBe(false);
    expect(F.ver_anexos(s, { order_id: "GCH900001" }).ok).toBe(true);
  });

  it("chamado: um por pedido enquanto houver aberto", () => {
    const s = new Simulador({
      base: base({
        chamados: [{ chamado_id: "VL-1", transportadora: "ViaLog", order_id: "GCH900001", conversation_id: null, data_abertura: "2026-10-31 10:00:00", motivo: "x", prazo_resposta: null, status: "respondido", resposta_transportadora: null, nova_previsao_entrega: null, data_encerramento: null }],
      }),
    });
    expect(F.abrir_chamado_transportadora(s, { order_id: "GCH900001", motivo: "rastreio parado" }).ok).toBe(false);
    expect(F.abrir_chamado_transportadora(s, { order_id: "GCH900002", motivo: "rastreio parado" }).ok).toBe(true);
  });
});

describe("notificações proativas (máx. 300 por dia)", () => {
  it("300 no dia passam; a 301ª é recusada; no dia seguinte zera", () => {
    let agora = "2026-11-02 09:00:00";
    const s = new Simulador({ base: base(), papel: "analista", agora: () => agora });
    const ids = (n: number, ini = 0) => Array.from({ length: n }, (_, i) => `GCH${String(ini + i).padStart(6, "0")}`);
    expect(F.notificar_clientes(s, { order_ids: ids(250), tipo_aviso: "atraso", texto: "Seu pedido atrasou." }).ok).toBe(true);
    const r = F.notificar_clientes(s, { order_ids: ids(50, 250), tipo_aviso: "atraso", texto: "Seu pedido atrasou." });
    expect(r.ok && r.dados).toMatchObject({ notificados: 50, restantesHoje: 0 });
    expect(F.notificar_clientes(s, { order_ids: ids(1, 900), tipo_aviso: "atraso", texto: "Seu pedido atrasou." }).ok).toBe(false);
    agora = "2026-11-03 08:00:00";
    expect(F.notificar_clientes(s, { order_ids: ids(1, 900), tipo_aviso: "atraso", texto: "Seu pedido atrasou." }).ok).toBe(true);
  });

  it("pedidos repetidos contam uma vez", () => {
    const s = new Simulador({ base: base(), papel: "analista" });
    const r = F.notificar_clientes(s, { order_ids: ["A", "A", "B"], tipo_aviso: "x", texto: "Aviso" });
    expect(r.ok && r.dados?.notificados).toBe(2);
  });
});

describe("demais ações", () => {
  it("encerrar_conversa e acionar_pessoa registram", () => {
    const s = sim();
    expect(F.encerrar_conversa(s, { conversation_id: "AT900001" }).ok).toBe(true);
    expect(F.acionar_pessoa(s, { area: "logística", assunto: "Expressa Já", contexto: "recontato alto" }).ok).toBe(true);
    expect(s.log.map((l) => l.acao)).toEqual(["encerrar_conversa", "acionar_pessoa"]);
  });

  it("solicitar_aprovacao exige ação conhecida e justificativa", () => {
    expect(F.solicitar_aprovacao(sim(), { acao: "inventada", valor: 10, justificativa: "x" }).ok).toBe(false);
    expect(F.solicitar_aprovacao(sim(), { acao: "reembolsar", valor: 10, justificativa: " " }).ok).toBe(false);
  });

  it("pedido inexistente é recusado", () => {
    expect(F.reenviar_produto(sim(), { conversation_id: "AT900001", order_id: "GCH000000", valor: 10, motivo: "x" }).ok).toBe(false);
  });
});
