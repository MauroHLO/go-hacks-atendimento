import { describe, expect, it } from "vitest";
import {
  CENARIO_PADRAO,
  CENARIO_VIGENTE,
  compensaResolverSozinho,
  custoEsperadoResolver,
  decidirNivel,
  diasUteisEntre,
  LIMIAR_CONFIANCA,
  limiteDoAtendente,
  sorteio,
  MENSAGEM_EM_ANALISE,
  podeAprovar,
  podeDecidirSuspeita,
  probabilidadeImprocedente,
  type EntradaPolitica,
  type FatosPedido,
  type Motivo,
  type SinalEvidencia,
} from "./index";

// ---------- apoio (casos fictícios) ----------
// Os testes das regras de politicas.csv fixam o cenário VIGENTE; os do cenário configurável ficam no fim.

function entrada(motivo: Motivo, fatos: Partial<FatosPedido> = {}, extra: Partial<EntradaPolitica> = {}): EntradaPolitica {
  return {
    motivo,
    confiancaClassificador: 0.95,
    fatos: { statusEntrega: "em_transito", valorPedido: 120, ...fatos },
    sinais: [],
    valorAcao: 0,
    canal: "whatsapp",
    cenario: CENARIO_VIGENTE,
    ...extra,
  };
}

// Reclamação com evidência elegível e sem sinais: foto recebida, entregue há 2 dias, cliente sem reenvio.
const ELEGIVEL: Partial<FatosPedido> = {
  statusEntrega: "entregue",
  diasDesdeRecebimento: 2,
  temFoto: true,
  reenviosCliente12m: 0,
  valorPedido: 120,
};
function evidencia(motivo: Motivo, fatos: Partial<FatosPedido> = {}, extra: Partial<EntradaPolitica> = {}) {
  return decidirNivel(entrada(motivo, { ...ELEGIVEL, ...fatos }, { valorAcao: 80, ...extra }));
}

// ---------- Rastreio ----------

describe("rastreio", () => {
  it("em trânsito dentro do prazo: nível 0, informa status", () => {
    const r = decidirNivel(entrada("rastreio", { diasUteisAtraso: 0, diasUteisSemAtualizacao: 1 }));
    expect(r).toMatchObject({ nivel: 0, ferramenta: "informar_status" });
    expect(r.precisaAprovacaoDe).toBeUndefined();
    expect(r.justificativa).toContain("politicas.csv › categorias › onde_esta_pedido.regra");
  });

  it("parado há 3 dias úteis (borda): nível 0, abre chamado", () => {
    const r = decidirNivel(entrada("rastreio", { diasUteisAtraso: 0, diasUteisSemAtualizacao: 3 }));
    expect(r).toMatchObject({ nivel: 0, ferramenta: "abrir_chamado_transportadora" });
  });

  it("parado há 2 dias úteis: ainda informa status", () => {
    const r = decidirNivel(entrada("rastreio", { diasUteisAtraso: 0, diasUteisSemAtualizacao: 2 }));
    expect(r.ferramenta).toBe("informar_status");
  });

  it("fora do prazo vira regra de atraso", () => {
    expect(decidirNivel(entrada("rastreio", { diasUteisAtraso: 3 })).ferramenta).toBe("abrir_chamado_transportadora");
    expect(decidirNivel(entrada("rastreio", { diasUteisAtraso: 9 })).nivel).toBe(1);
  });

  it("pedido entregue: fora da tabela, nível 1", () => {
    expect(decidirNivel(entrada("rastreio", { statusEntrega: "entregue" })).nivel).toBe(1);
  });
});

// ---------- Atraso ----------

describe("atraso", () => {
  it("até 7 dias úteis (borda 7): nível 0, abre chamado", () => {
    const r = decidirNivel(entrada("atraso", { diasUteisAtraso: 7 }));
    expect(r).toMatchObject({ nivel: 0, ferramenta: "abrir_chamado_transportadora" });
    expect(r.justificativa).toContain("atraso_entrega.regra");
  });

  it("8 dias úteis: nível 1, reenvio ou reembolso à escolha do cliente", () => {
    const r = decidirNivel(entrada("atraso", { diasUteisAtraso: 8 }));
    expect(r).toMatchObject({
      nivel: 1,
      acao: "reenvio_ou_reembolso",
      ferramenta: "reenviar_produto",
      ferramentasAdicionais: ["reembolsar"],
      precisaAprovacaoDe: "supervisor",
    });
  });

  it("extravio: nível 1 mesmo sem dias de atraso", () => {
    expect(decidirNivel(entrada("atraso", { statusEntrega: "extraviado" }))).toMatchObject({ nivel: 1, acao: "reenvio_ou_reembolso" });
  });

  it("dias úteis de atraso desconhecidos: nível 1", () => {
    expect(decidirNivel(entrada("atraso")).nivel).toBe(1);
  });

  it("ainda dentro do prazo: informa status", () => {
    expect(decidirNivel(entrada("atraso", { diasUteisAtraso: 0 })).ferramenta).toBe("informar_status");
  });
});

// ---------- Avaria, item faltante, brinde, erro de personalização ----------

describe.each<[Motivo, string]>([
  ["avaria", "reenviar_produto"],
  ["item_faltante", "reenviar_produto"],
  ["brinde", "reenviar_produto"],
  ["erro_personalizacao", "reimprimir_personalizacao"],
])("%s", (motivo, ferramenta) => {
  it("foto, sem sinal, dentro de 7 dias, até R$ 200, sem reenvio: nível 0", () => {
    const r = evidencia(motivo);
    expect(r).toMatchObject({ nivel: 0, ferramenta });
    expect(r.precisaAprovacaoDe).toBeUndefined();
  });

  it("sinal fraco em pedido de R$ 120: a fórmula manda para nível 1", () => {
    expect(evidencia(motivo, {}, { sinais: ["software_de_edicao"] })).toMatchObject({ nivel: 1, ferramenta, precisaAprovacaoDe: "supervisor" });
  });

  it("sinal fraco em pedido de R$ 50: a fórmula resolve no nível 0", () => {
    expect(evidencia(motivo, { valorPedido: 50 }, { valorAcao: 50, sinais: ["software_de_edicao"] })).toMatchObject({ nivel: 0, ferramenta });
  });

  it("valor da ação acima de R$ 200: nível 1", () => {
    expect(evidencia(motivo, { valorPedido: 210 }, { valorAcao: 200.01 })).toMatchObject({ nivel: 1, ferramenta });
  });

  it("1 reenvio em 12 meses não é sinal: continua nível 0", () => {
    expect(evidencia(motivo, { reenviosCliente12m: 1 })).toMatchObject({ nivel: 0, ferramenta });
  });

  it.each<SinalEvidencia>(["hash_em_outro_pedido_ou_cliente", "exif_antes_da_entrega", "produto_da_foto_diferente_do_pedido"])(
    "sinal forte %s: nível 2, sinalizar_suspeita, mensagem só 'em análise'",
    (sinal) => {
      const r = evidencia(motivo, {}, { sinais: [sinal] });
      expect(r).toMatchObject({ nivel: 2, ferramenta: "sinalizar_suspeita", precisaAprovacaoDe: "supervisor", mensagemCliente: MENSAGEM_EM_ANALISE });
      expect(r.ferramenta).not.toBe("negar_por_politica"); // nunca nega por suspeita
      expect(r.mensagemCliente!.toLowerCase()).not.toMatch(/fraud|suspeit|falsa|mentir|golpe/);
      expect(r.justificativa).toContain("reclamacao_suspeita");
    },
  );
});

describe("evidência: bordas e elegibilidade", () => {
  it("R$ 200 exatos: nível 0; R$ 200,01: nível 1", () => {
    expect(evidencia("avaria", { valorPedido: 200 }, { valorAcao: 200 }).nivel).toBe(0);
    expect(evidencia("avaria", { valorPedido: 200 }, { valorAcao: 200.01 }).nivel).toBe(1);
  });

  it("7 dias do recebimento: dentro; 8 dias: nega por política (não é suspeita)", () => {
    expect(evidencia("avaria", { diasDesdeRecebimento: 7 }).nivel).toBe(0);
    const fora = evidencia("avaria", { diasDesdeRecebimento: 8 });
    expect(fora).toMatchObject({ nivel: 0, ferramenta: "negar_por_politica" });
    expect(fora.mensagemCliente).toBeUndefined();
  });

  it("sinal fora_do_prazo_7_dias vindo de lib/evidencias: nega por política", () => {
    expect(evidencia("item_faltante", {}, { sinais: ["fora_do_prazo_7_dias"] }).ferramenta).toBe("negar_por_politica");
  });

  it("sem foto: solicita foto (pelo fato ou pelo sinal)", () => {
    expect(evidencia("avaria", { temFoto: false })).toMatchObject({ nivel: 0, ferramenta: "solicitar_foto" });
    expect(evidencia("avaria", {}, { sinais: ["sem_foto"] })).toMatchObject({ nivel: 0, ferramenta: "solicitar_foto" });
    expect(evidencia("avaria", { temFoto: undefined }).ferramenta).toBe("solicitar_foto");
  });

  it("sem foto e com sinal forte: pede a foto primeiro (elegibilidade antes de suspeita)", () => {
    expect(evidencia("avaria", { temFoto: false }, { sinais: ["exif_antes_da_entrega"] }).ferramenta).toBe("solicitar_foto");
  });

  it("pedido não entregue ou sem data de recebimento: nível 1", () => {
    expect(evidencia("avaria", { statusEntrega: "em_transito" }).nivel).toBe(1);
    expect(evidencia("avaria", { diasDesdeRecebimento: undefined }).nivel).toBe(1);
  });

  it("2 ou mais reenvios em 12 meses vira sinal fraco", () => {
    const r = evidencia("avaria", { reenviosCliente12m: 2 });
    expect(r.nivel).toBe(1);
    expect(r.justificativa).toContain("cliente_2_ou_mais_reenvios_12m");
    expect(r.justificativa).toContain("p=0.15");
  });

  it("sinal forte com valor acima do limite continua nível 2", () => {
    expect(evidencia("avaria", { valorPedido: 500 }, { valorAcao: 500, sinais: ["exif_antes_da_entrega"] }).nivel).toBe(2);
  });

  it("sinal forte e sinal fraco juntos: nível 2", () => {
    expect(evidencia("avaria", {}, { sinais: ["software_de_edicao", "hash_em_outro_pedido_ou_cliente"] }).nivel).toBe(2);
  });
});

// ---------- Fórmula de custo esperado ----------

describe("custo esperado: p × 0,45 × valor do pedido < R$ 6", () => {
  it("probabilidade inicial por sinais", () => {
    expect(probabilidadeImprocedente([])).toBe(0.05);
    expect(probabilidadeImprocedente(["software_de_edicao"])).toBe(0.15);
    expect(probabilidadeImprocedente(["software_de_edicao", "cliente_2_ou_mais_reenvios_12m"])).toBe(0.3);
    expect(probabilidadeImprocedente(["software_de_edicao", "software_de_edicao"])).toBe(0.15); // repetido conta uma vez
    expect(probabilidadeImprocedente(["exif_antes_da_entrega"])).toBe(0.9);
    expect(probabilidadeImprocedente(["sem_foto", "fora_do_prazo_7_dias"])).toBe(0.05); // elegibilidade não é suspeita
  });

  it("estampa × pedido personalizado é sinal fraco (rebaixado): p 0,15, e não vai ao supervisor sozinho", () => {
    expect(probabilidadeImprocedente(["estampa_em_pedido_personalizado"])).toBe(0.15);
    // R$ 80: 0,15 × 0,45 × 80 = 5,40 < 6 → nível 0 (antes, como forte, ia ao supervisor no nível 2)
    expect(decidirNivel(entrada("avaria", { temFoto: true, statusEntrega: "entregue", diasDesdeRecebimento: 2, valorPedido: 80 }, { sinais: ["estampa_em_pedido_personalizado"], valorAcao: 80 })).nivel).toBe(0);
    // com hash repetido (forte) continua no nível 2
    expect(decidirNivel(entrada("avaria", { temFoto: true, statusEntrega: "entregue", diasDesdeRecebimento: 2, valorPedido: 80 }, { sinais: ["estampa_em_pedido_personalizado", "hash_em_outro_pedido_ou_cliente"], valorAcao: 80 })).nivel).toBe(2);
  });

  // Bordas: 6 / (p × 0,45) → 266,67 (p 0,05); 88,89 (0,15); 44,44 (0,30); 14,81 (0,90)
  it.each<[number, number, number]>([
    [0.05, 266.66, 266.67],
    [0.15, 88.88, 88.89],
    [0.3, 44.44, 44.45],
    [0.9, 14.81, 14.82],
  ])("p=%s: compensa com R$ %s, não compensa com R$ %s", (p, abaixo, acima) => {
    expect(compensaResolverSozinho(p, abaixo)).toBe(true);
    expect(compensaResolverSozinho(p, acima)).toBe(false);
  });

  it("custo exatamente R$ 6 não compensa (desigualdade estrita)", () => {
    expect(custoEsperadoResolver(0.5, 6 / 0.225)).toBeCloseTo(6, 10);
    expect(compensaResolverSozinho(1, 6 / 0.45)).toBe(false);
  });

  it("no motor: sem sinal, pedido de R$ 266,66 resolve; R$ 266,67 vai para nível 1", () => {
    expect(evidencia("item_faltante", { valorPedido: 266.66 }, { valorAcao: 50 }).nivel).toBe(0);
    const r = evidencia("item_faltante", { valorPedido: 266.67 }, { valorAcao: 50 });
    expect(r.nivel).toBe(1);
    expect(r.justificativa).toContain("custo esperado acima do de sinalizar");
  });

  it("um sinal fraco: R$ 88,88 resolve; R$ 88,89 vai para nível 1", () => {
    const fraco: SinalEvidencia[] = ["software_de_edicao"];
    expect(evidencia("avaria", { valorPedido: 88.88 }, { valorAcao: 50, sinais: fraco }).nivel).toBe(0);
    expect(evidencia("avaria", { valorPedido: 88.89 }, { valorAcao: 50, sinais: fraco }).nivel).toBe(1);
  });

  it("dois sinais fracos: R$ 44,44 resolve; R$ 44,45 vai para nível 1", () => {
    const fracos: SinalEvidencia[] = ["software_de_edicao", "cliente_2_ou_mais_reenvios_12m"];
    expect(evidencia("avaria", { valorPedido: 44.44 }, { valorAcao: 44.44, sinais: fracos }).nivel).toBe(0);
    expect(evidencia("avaria", { valorPedido: 44.45 }, { valorAcao: 44.45, sinais: fracos }).nivel).toBe(1);
  });

  it("2+ reenvios pelo fato do CRM contam como sinal fraco na fórmula", () => {
    expect(evidencia("avaria", { valorPedido: 80, reenviosCliente12m: 3 }, { valorAcao: 80 }).nivel).toBe(0); // 0,15 × 0,45 × 80 = 5,40
    expect(evidencia("avaria", { valorPedido: 100, reenviosCliente12m: 3 }, { valorAcao: 80 }).nivel).toBe(1); // 6,75
  });

  it("fórmula compensa mas valor da ação passa do limite: nível 1", () => {
    expect(compensaResolverSozinho(0.05, 250)).toBe(true);
    expect(evidencia("avaria", { valorPedido: 250 }, { valorAcao: 250 }).nivel).toBe(1);
  });

  it("sinal forte com pedido pequeno: nível 2 mesmo com a fórmula compensando", () => {
    expect(compensaResolverSozinho(0.9, 10)).toBe(true);
    expect(evidencia("avaria", { valorPedido: 10 }, { valorAcao: 10, sinais: ["exif_antes_da_entrega"] }).nivel).toBe(2);
  });
});

// ---------- Cobrança duplicada ----------

describe("cobrança duplicada", () => {
  const confirmada = { duplicidadeConfirmadaGateway: true, duplicidadeJaEstornada: false };

  it("confirmada, sem estorno, R$ 100 exatos (borda): nível 0, estorna", () => {
    const r = decidirNivel(entrada("cobranca_duplicada", confirmada, { valorAcao: 100 }));
    expect(r).toMatchObject({ nivel: 0, ferramenta: "reembolsar" });
    expect(r.justificativa).toContain("cobranca_duplicada.regra");
  });

  it("R$ 100,01: nível 1, supervisor aprova", () => {
    expect(decidirNivel(entrada("cobranca_duplicada", confirmada, { valorAcao: 100.01 }))).toMatchObject({
      nivel: 1,
      ferramenta: "reembolsar",
      precisaAprovacaoDe: "supervisor",
    });
  });

  it("não confirmada ou já estornada: nível 1, verificar pagamento", () => {
    expect(decidirNivel(entrada("cobranca_duplicada", { duplicidadeConfirmadaGateway: false }, { valorAcao: 50 }))).toMatchObject({ nivel: 1, ferramenta: "verificar_pagamento" });
    expect(decidirNivel(entrada("cobranca_duplicada", { ...confirmada, duplicidadeJaEstornada: true }, { valorAcao: 50 })).nivel).toBe(1);
    expect(decidirNivel(entrada("cobranca_duplicada", { duplicidadeConfirmadaGateway: true }, { valorAcao: 50 })).nivel).toBe(1);
  });
});

// ---------- Endereço ----------

describe("endereço", () => {
  it("antes da separação: nível 0, altera", () => {
    expect(decidirNivel(entrada("endereco", { statusEntrega: "aguardando_separacao", separado: false }))).toMatchObject({ nivel: 0, ferramenta: "alterar_endereco" });
  });
  it("em separação: nível 1", () => {
    expect(decidirNivel(entrada("endereco", { statusEntrega: "aguardando_separacao", separado: true }))).toMatchObject({ nivel: 1, ferramenta: "alterar_endereco" });
  });
  it.each(["em_transito", "entregue"] as const)("%s: nível 0, recusa com a política", (statusEntrega) => {
    const r = decidirNivel(entrada("endereco", { statusEntrega }));
    expect(r).toMatchObject({ nivel: 0, ferramenta: "negar_por_politica" });
    expect(r.justificativa).toContain("alteracao_endereco.regra");
  });
});

// ---------- Sempre nível 1 ----------

describe("cancelamento ou arrependimento: sempre nível 1", () => {
  it.each<[string, Partial<FatosPedido>, string]>([
    ["antes da separação", { statusEntrega: "aguardando_separacao", separado: false }, "cancelar_pedido"],
    ["recebido há 7 dias", { statusEntrega: "entregue", diasDesdeRecebimento: 7 }, "reembolsar"],
    ["recebido há 8 dias", { statusEntrega: "entregue", diasDesdeRecebimento: 8 }, "negar_por_politica"],
    ["em trânsito", { statusEntrega: "em_transito" }, "cancelar_pedido"],
  ])("%s", (_n, fatos, ferramenta) => {
    expect(decidirNivel(entrada("cancelamento", fatos, { valorAcao: 50 }))).toMatchObject({ nivel: 1, ferramenta, precisaAprovacaoDe: "supervisor" });
  });
});

describe("troca de fragrância: sempre nível 1", () => {
  it("dentro das regras: prepara a troca e cita os 20%", () => {
    const r = decidirNivel(entrada("troca_fragrancia", { statusEntrega: "entregue", diasDesdeRecebimento: 10, trocasNoPedido: 0 }, { valorAcao: 90 }));
    expect(r).toMatchObject({ nivel: 1, ferramenta: "trocar_produto" });
    expect(r.justificativa).toContain("20%");
  });
  it("já trocou uma vez ou passou de 30 dias: nível 1 com negativa preparada", () => {
    expect(decidirNivel(entrada("troca_fragrancia", { trocasNoPedido: 1 }))).toMatchObject({ nivel: 1, ferramenta: "negar_por_politica" });
    expect(decidirNivel(entrada("troca_fragrancia", { diasDesdeRecebimento: 31 }))).toMatchObject({ nivel: 1, ferramenta: "negar_por_politica" });
    expect(decidirNivel(entrada("troca_fragrancia", { diasDesdeRecebimento: 30 })).ferramenta).toBe("trocar_produto");
  });
});

// ---------- Dúvida de produto ----------

describe("dúvida de produto", () => {
  it("com ficha: nível 0", () => {
    expect(decidirNivel(entrada("duvida_produto", { temFichaProduto: true }))).toMatchObject({ nivel: 0, ferramenta: "responder_duvida" });
  });
  it("sem ficha: nível 1", () => {
    expect(decidirNivel(entrada("duvida_produto", { temFichaProduto: false })).nivel).toBe(1);
    expect(decidirNivel(entrada("duvida_produto")).nivel).toBe(1);
  });
  it("menção de saúde ou reação: nível 2, mesmo com ficha", () => {
    expect(decidirNivel(entrada("duvida_produto", { temFichaProduto: true }, { mencaoSaude: true })).nivel).toBe(2);
  });
});

// ---------- Cupom e reação adversa ----------

describe("cupom", () => {
  it("nível 0, validar_cupom", () => {
    expect(decidirNivel(entrada("cupom"))).toMatchObject({ nivel: 0, ferramenta: "validar_cupom" });
  });
});

describe("reação adversa", () => {
  it("sempre nível 2: orienta suspensão e registra cosmetovigilância em 24 h", () => {
    const r = decidirNivel(entrada("reacao_adversa", { statusEntrega: "entregue" }, { valorAcao: 30 }));
    expect(r).toMatchObject({
      nivel: 2,
      ferramenta: "registrar_cosmetovigilancia",
      ferramentasAdicionais: ["orientar_suspensao_uso"],
      precisaAprovacaoDe: "supervisor",
    });
    expect(r.ferramenta).not.toBe("trocar_produto");
    expect(r.justificativa).toContain("24 h");
    expect(r.justificativa).toContain("reacao_adversa.regra");
  });
  it("Reclame Aqui e confiança baixa não baixam o nível 2", () => {
    expect(decidirNivel(entrada("reacao_adversa", {}, { canal: "reclame_aqui", confiancaClassificador: 0.2 })).nivel).toBe(2);
  });
});

// ---------- Reclame Aqui e confiança ----------

describe("Reclame Aqui: sempre pelo menos nível 1", () => {
  it("motivo de nível 0 sobe para 1 e cita a resposta pública", () => {
    const r = decidirNivel(entrada("cupom", {}, { canal: "reclame_aqui" }));
    expect(r).toMatchObject({ nivel: 1, ferramenta: "validar_cupom", precisaAprovacaoDe: "supervisor" });
    expect(r.justificativa).toContain("reclame_aqui.resposta_publica");
  });
  it("sinal forte no Reclame Aqui continua nível 2", () => {
    expect(evidencia("avaria", {}, { canal: "reclame_aqui", sinais: ["exif_antes_da_entrega"] }).nivel).toBe(2);
  });
});

describe("confiança do classificador", () => {
  it(`0,7 exato (borda) não sobe; ${LIMIAR_CONFIANCA - 0.01} sobe para 1`, () => {
    expect(decidirNivel(entrada("cupom", {}, { confiancaClassificador: 0.7 })).nivel).toBe(0);
    const r = decidirNivel(entrada("cupom", {}, { confiancaClassificador: 0.69 }));
    expect(r.nivel).toBe(1);
    expect(r.justificativa).toContain("0.69");
  });
  it("só sobe até 1: nível 2 fica 2, nível 1 fica 1", () => {
    expect(decidirNivel(entrada("cancelamento", {}, { confiancaClassificador: 0.1 })).nivel).toBe(1);
    expect(evidencia("avaria", {}, { confiancaClassificador: 0.1, sinais: ["exif_antes_da_entrega"] }).nivel).toBe(2);
  });
});

// ---------- Fora da tabela e validação ----------

describe("fora da tabela", () => {
  it("outro: nível 1", () => {
    expect(decidirNivel(entrada("outro")).nivel).toBe(1);
  });
});

describe("sem demanda", () => {
  it("cliente não escreveu nada: nível 0, encerra sem ação, citando a política", () => {
    const r = decidirNivel(entrada("sem_demanda"));
    expect(r).toMatchObject({ nivel: 0, acao: "encerrar_sem_acao", ferramenta: "encerrar_conversa" });
    expect(r.justificativa).toContain("sem_interacao.acoes_permitidas");
  });
  it("não entra no sorteio da auditoria", () => {
    const cenario = { ...CENARIO_VIGENTE, auditoriaAmostraPct: 100 };
    expect(decidirNivel(entrada("sem_demanda", {}, { cenario, chaveAmostra: "AT1" })).auditoriaPosterior).toBeUndefined();
    expect(decidirNivel(entrada("elogio", {}, { cenario, chaveAmostra: "AT1" })).auditoriaPosterior).toBe(true);
  });
});

describe("pagamento pendente e elogio", () => {
  it("pagamento pendente: nível 0, verifica no gateway e informa", () => {
    expect(decidirNivel(entrada("pagamento_pendente"))).toMatchObject({
      nivel: 0,
      ferramenta: "verificar_pagamento",
      ferramentasAdicionais: ["informar_status"],
    });
  });
  it("elogio: nível 0, agradece", () => {
    const r = decidirNivel(entrada("elogio"));
    expect(r).toMatchObject({ nivel: 0, ferramenta: "agradecer" });
    expect(r.justificativa).toContain("elogio.acoes_permitidas");
  });
  it("no Reclame Aqui sobem para nível 1", () => {
    expect(decidirNivel(entrada("elogio", {}, { canal: "reclame_aqui" })).nivel).toBe(1);
  });
});

describe("validação da entrada", () => {
  it.each<[string, Partial<EntradaPolitica>]>([
    ["confiança acima de 1", { confiancaClassificador: 1.1 }],
    ["confiança negativa", { confiancaClassificador: -0.1 }],
    ["confiança NaN", { confiancaClassificador: Number.NaN }],
    ["valor da ação negativo", { valorAcao: -1 }],
    ["motivo desconhecido", { motivo: "inventado" as Motivo }],
  ])("%s → RangeError", (_n, extra) => {
    expect(() => decidirNivel(entrada("cupom", {}, extra))).toThrow(RangeError);
  });
});

// ---------- Limites gerais e segregação de funções ----------

describe("aprovação e suspeita", () => {
  const atendente = { id: "atendente_01", papel: "atendente" as const };
  const sup1 = { id: "supervisor_01", papel: "supervisor" as const };
  const sup2 = { id: "supervisor_02", papel: "supervisor" as const };

  it("supervisor aprova ação de outra pessoa", () => {
    expect(podeAprovar(sup1, atendente).ok).toBe(true);
    expect(podeAprovar(sup1, sup2).ok).toBe(true);
  });
  it("supervisor não aprova a própria ação", () => {
    const r = podeAprovar(sup1, sup1);
    expect(r.ok).toBe(false);
    expect(r.justificativa).toContain("nao_aprova_a_propria_acao");
  });
  it("atendente não aprova", () => {
    expect(podeAprovar(atendente, sup1).ok).toBe(false);
  });
  it("supervisor não decide suspeita que ele mesmo sinalizou", () => {
    expect(podeDecidirSuspeita(sup1, sup1).ok).toBe(false);
    expect(podeDecidirSuspeita(sup1, atendente).ok).toBe(true);
    expect(podeDecidirSuspeita(atendente, sup1).ok).toBe(false);
  });
});

// ---------- Calendário ----------

describe("dias úteis", () => {
  it("pula fim de semana e feriado (02/11/2026, segunda)", () => {
    expect(diasUteisEntre("2026-10-30", "2026-11-02")).toBe(0); // sex -> seg feriado
    expect(diasUteisEntre("2026-10-30", "2026-11-05")).toBe(3); // ter, qua, qui
    expect(diasUteisEntre("2026-11-05", "2026-11-05")).toBe(0);
    expect(diasUteisEntre("2026-11-06", "2026-11-03")).toBe(0);
  });
  it("rastreio parado: 3 dias úteis contados no calendário abrem chamado", () => {
    const parado = diasUteisEntre("2026-10-29", "2026-11-04"); // sex, ter, qua
    expect(parado).toBe(3);
    expect(decidirNivel(entrada("rastreio", { diasUteisAtraso: 0, diasUteisSemAtualizacao: parado })).ferramenta).toBe("abrir_chamado_transportadora");
  });
});

// ---------- Cenário de política (docs/decisoes.md, seção 4) ----------

describe("cenário: padrão recomendado pela simulação", () => {
  it("limite de reenvio 300, auditoria 10%, fotos bloqueadas, brinde sem foto desligado, direito comprovado no nível 0, freio R$ 3.000", () => {
    expect(CENARIO_PADRAO).toMatchObject({
      limiteReenvioRs: 300,
      auditoriaAmostraPct: 10,
      estornoDuplicidadeSemTeto: true,
      brindeSemFoto: false,
      bloquearFotosConfirmadas: true,
      freioDiarioRs: 3000,
      pSemSinal: 0.05,
      cancelamentoAntesSeparacaoNivel0: true,
      atrasoComprovadoNivel0: true,
      trocaFragranciaNivel0: true,
      reclameAquiSeparaResposta: true,
    });
  });
  it("vigente reproduz politicas.csv", () => {
    expect(CENARIO_VIGENTE).toMatchObject({
      limiteReenvioRs: 200,
      auditoriaAmostraPct: 0,
      estornoDuplicidadeSemTeto: false,
      brindeSemFoto: false,
      freioDiarioRs: null,
      pSemSinal: 0.05,
      cancelamentoAntesSeparacaoNivel0: false,
      atrasoComprovadoNivel0: false,
      trocaFragranciaNivel0: false,
      reclameAquiSeparaResposta: false,
    });
  });
  it("sem cenário na entrada vale o padrão", () => {
    const { cenario: _c, ...semCenario } = entrada("avaria", { ...ELEGIVEL, valorPedido: 100 }, { valorAcao: 300 });
    void _c;
    expect(decidirNivel(semCenario).nivel).toBe(0); // 300 <= 300 do padrão
  });
});

describe("cenário: limite do atendente para reenvio", () => {
  const cen = { ...CENARIO_VIGENTE, limiteReenvioRs: 300, pSemSinal: 0.02 }; // p 0,02 para a fórmula não ser o que barra
  it("R$ 300 exatos passa; R$ 300,01 vai para nível 1", () => {
    expect(evidencia("avaria", { valorPedido: 300 }, { valorAcao: 300, cenario: cen }).nivel).toBe(0);
    expect(evidencia("avaria", { valorPedido: 300 }, { valorAcao: 300.01, cenario: cen }).nivel).toBe(1);
  });
  it("vale para reimpressão; troca continua em R$ 200 e reembolso em R$ 100", () => {
    expect(evidencia("erro_personalizacao", { valorPedido: 250 }, { valorAcao: 250, cenario: cen }).nivel).toBe(0);
    expect(limiteDoAtendente("trocar_produto", cen)).toBe(200);
    expect(limiteDoAtendente("reembolsar", cen)).toBe(100);
  });
});

describe("cenário: auditoria por amostra", () => {
  const cen = { ...CENARIO_VIGENTE, auditoriaAmostraPct: 10 };
  const chaves = Array.from({ length: 2000 }, (_, i) => `AT${String(100000 + i)}`);
  it("desligada: nenhum caso sorteado", () => {
    expect(chaves.some((k) => decidirNivel(entrada("cupom", {}, { chaveAmostra: k })).auditoriaPosterior)).toBe(false);
  });
  it("ligada: cerca de 10% do nível 0 sorteado, executa no nível 0 e cita a regra", () => {
    const sorteados = chaves.filter((k) => decidirNivel(entrada("cupom", {}, { chaveAmostra: k, cenario: cen })).auditoriaPosterior);
    expect(sorteados.length / chaves.length).toBeGreaterThan(0.08);
    expect(sorteados.length / chaves.length).toBeLessThan(0.12);
    const d = decidirNivel(entrada("cupom", {}, { chaveAmostra: sorteados[0], cenario: cen }));
    expect(d.nivel).toBe(0);
    expect(d.justificativa).toContain("auditoria");
  });
  it("sorteio determinístico e só no nível 0", () => {
    const k = chaves.find((x) => sorteio(x) < 10)!;
    expect(sorteio(k)).toBe(sorteio(k));
    expect(decidirNivel(entrada("cancelamento", {}, { chaveAmostra: k, cenario: cen })).auditoriaPosterior).toBeUndefined();
  });
  it("sem chave não sorteia", () => {
    expect(decidirNivel(entrada("cupom", {}, { cenario: { ...cen, auditoriaAmostraPct: 100 } })).auditoriaPosterior).toBeUndefined();
  });
});

describe("cenário: estorno de duplicidade sem teto", () => {
  const confirmada = { duplicidadeConfirmadaGateway: true, duplicidadeJaEstornada: false };
  const cen = { ...CENARIO_VIGENTE, estornoDuplicidadeSemTeto: true };
  it("ligado: R$ 450 comprovado no gateway vai no nível 0 (pedido de R$ 450)", () => {
    const r = decidirNivel(entrada("cobranca_duplicada", { ...confirmada, valorPedido: 450 }, { valorAcao: 450, cenario: cen }));
    expect(r).toMatchObject({ nivel: 0, ferramenta: "reembolsar", acaoSemTeto: true });
    expect(r.justificativa).toContain("estorno de duplicidade sem teto");
  });
  it("ligado: acima do valor do pedido vai para nível 1", () => {
    const r = decidirNivel(entrada("cobranca_duplicada", { ...confirmada, valorPedido: 450 }, { valorAcao: 450.01, cenario: cen }));
    expect(r.nivel).toBe(1);
    expect(r.acaoSemTeto).toBeUndefined();
    expect(r.justificativa).toContain("acima do valor do pedido");
  });
  it("ligado, mas sem comprovação no gateway: continua nível 1", () => {
    expect(decidirNivel(entrada("cobranca_duplicada", { duplicidadeConfirmadaGateway: false }, { valorAcao: 450, cenario: cen })).nivel).toBe(1);
  });
  it("não tira o teto de outros reembolsos", () => {
    expect(decidirNivel(entrada("atraso", { diasUteisAtraso: 9 }, { valorAcao: 450, cenario: cen })).nivel).toBe(1);
  });
});

describe("cenário: brinde sem foto", () => {
  const cen = { ...CENARIO_VIGENTE, brindeSemFoto: true };
  it("ligado: brinde sem foto vai para a fórmula e resolve no nível 0", () => {
    const r = evidencia("brinde", { temFoto: false, valorPedido: 150 }, { valorAcao: 24.9, cenario: cen });
    expect(r).toMatchObject({ nivel: 0, ferramenta: "reenviar_produto" });
    expect(r.justificativa).toContain("brinde sem foto");
  });
  it("ligado: pedido acima de R$ 266,66 com p 0,05 vai para nível 1 pela fórmula", () => {
    expect(evidencia("brinde", { temFoto: false, valorPedido: 300 }, { valorAcao: 24.9, cenario: cen }).nivel).toBe(1);
  });
  it("não vale para item faltante nem avaria", () => {
    expect(evidencia("item_faltante", { temFoto: false }, { cenario: cen }).ferramenta).toBe("solicitar_foto");
    expect(evidencia("avaria", { temFoto: false }, { cenario: cen }).ferramenta).toBe("solicitar_foto");
  });
  it("desligado: brinde sem foto pede a foto", () => {
    expect(evidencia("brinde", { temFoto: false }).ferramenta).toBe("solicitar_foto");
  });
});

describe("cenário: fotos bloqueadas", () => {
  const cen = { ...CENARIO_VIGENTE, bloquearFotosConfirmadas: true, hashesBloqueados: new Set(["ffff000011112222"]) };
  it("ligada: foto com hash confirmado vai para nível 2 antes de qualquer regra, sem acusação", () => {
    const r = evidencia("avaria", { diasDesdeRecebimento: 20 }, { hashesFotos: ["aaaa", "ffff000011112222"], cenario: cen });
    expect(r).toMatchObject({ nivel: 2, ferramenta: "sinalizar_suspeita", mensagemCliente: MENSAGEM_EM_ANALISE });
    expect(r.justificativa).toContain("fotos bloqueadas");
  });
  it("hash fora da lista segue a regra normal", () => {
    expect(evidencia("avaria", {}, { hashesFotos: ["aaaa"], cenario: cen }).nivel).toBe(0);
  });
  it("desligada: a lista é ignorada", () => {
    expect(evidencia("avaria", {}, { hashesFotos: ["ffff000011112222"], cenario: { ...cen, bloquearFotosConfirmadas: false } }).nivel).toBe(0);
  });
});

describe("cenário: freio diário (só ações sem teto)", () => {
  const confirmada = { duplicidadeConfirmadaGateway: true, duplicidadeJaEstornada: false, valorPedido: 500 };
  const cen = { ...CENARIO_VIGENTE, estornoDuplicidadeSemTeto: true, freioDiarioRs: 1000 };
  it("até o teto exato: nível 0; um centavo acima: nível 1 com a regra citada", () => {
    expect(decidirNivel(entrada("cobranca_duplicada", confirmada, { valorAcao: 80, gastoAutonomoHojeRs: 920, cenario: cen })).nivel).toBe(0);
    const r = decidirNivel(entrada("cobranca_duplicada", confirmada, { valorAcao: 80, gastoAutonomoHojeRs: 920.01, cenario: cen }));
    expect(r.nivel).toBe(1);
    expect(r.justificativa).toContain("Freio diário");
  });
  it("ação pela fórmula (com teto do atendente) não é freada", () => {
    expect(evidencia("avaria", {}, { valorAcao: 80, gastoAutonomoHojeRs: 1e9, cenario: cen }).nivel).toBe(0);
  });
  it("ação sem dinheiro não é freada", () => {
    expect(decidirNivel(entrada("rastreio", { diasUteisAtraso: 0 }, { gastoAutonomoHojeRs: 99999, cenario: cen })).nivel).toBe(0);
  });
  it("desligado (null): sem teto", () => {
    expect(decidirNivel(entrada("cobranca_duplicada", confirmada, { valorAcao: 80, gastoAutonomoHojeRs: 1e9, cenario: { ...cen, freioDiarioRs: null } })).nivel).toBe(0);
  });
});

describe("cenário: p inicial sem sinal", () => {
  it.each<[number, number, number]>([
    [0.02, 666.66, 666.67],
    [0.05, 266.66, 266.67],
    [0.1, 133.33, 133.34],
  ])("p %s: pedido de R$ %s resolve, R$ %s vai para nível 1", (p, abaixo, acima) => {
    const cen = { ...CENARIO_VIGENTE, pSemSinal: p, limiteReenvioRs: 10_000 };
    expect(evidencia("item_faltante", { valorPedido: abaixo }, { valorAcao: 50, cenario: cen }).nivel).toBe(0);
    expect(evidencia("item_faltante", { valorPedido: acima }, { valorAcao: 50, cenario: cen }).nivel).toBe(1);
  });
  it("não muda a probabilidade com sinais", () => {
    expect(probabilidadeImprocedente(["software_de_edicao"], 0.01)).toBe(0.15);
  });
  it("cenário inválido → RangeError", () => {
    for (const ruim of [{ pSemSinal: 1.5 }, { auditoriaAmostraPct: 101 }, { limiteReenvioRs: -1 }, { freioDiarioRs: -5 }]) {
      expect(() => decidirNivel(entrada("cupom", {}, { cenario: { ...CENARIO_VIGENTE, ...ruim } }))).toThrow(RangeError);
    }
  });
});

// ---------- Direito comprovado por sistema (docs/decisoes.md, seção 5) ----------

describe("princípio: cancelamento antes da separação", () => {
  const cen = { ...CENARIO_VIGENTE, cancelamentoAntesSeparacaoNivel0: true };
  const antes = { statusEntrega: "aguardando_separacao" as const, separado: false, valorPedido: 899 };
  it("antes da separação (ERP): nível 0, cancelar_pedido + reembolso integral, sem teto até o valor do pedido", () => {
    const r = decidirNivel(entrada("cancelamento", antes, { valorAcao: 899, cenario: cen }));
    expect(r).toMatchObject({ nivel: 0, ferramenta: "cancelar_pedido", ferramentasAdicionais: ["reembolsar"], acaoSemTeto: true });
    expect(r.precisaAprovacaoDe).toBeUndefined();
    expect(r.justificativa).toContain("direito comprovado por sistema");
  });
  it("reembolso acima do valor do pedido: nível 1", () => {
    expect(decidirNivel(entrada("cancelamento", antes, { valorAcao: 899.01, cenario: cen })).nivel).toBe(1);
  });
  it("depois da separação continua nível 1", () => {
    expect(decidirNivel(entrada("cancelamento", { statusEntrega: "aguardando_separacao", separado: true }, { valorAcao: 50, cenario: cen })).nivel).toBe(1);
    expect(decidirNivel(entrada("cancelamento", { statusEntrega: "em_transito" }, { valorAcao: 50, cenario: cen })).nivel).toBe(1);
    expect(decidirNivel(entrada("cancelamento", { statusEntrega: "entregue", diasDesdeRecebimento: 3 }, { valorAcao: 50, cenario: cen })).nivel).toBe(1);
  });
  it("separação desconhecida: nível 1 (o motor não supõe)", () => {
    expect(decidirNivel(entrada("cancelamento", { statusEntrega: "aguardando_separacao" }, { valorAcao: 50, cenario: cen })).nivel).toBe(1);
  });
  it("desligado (vigente): nível 1", () => {
    expect(decidirNivel(entrada("cancelamento", antes, { valorAcao: 50 })).nivel).toBe(1);
  });
});

describe("princípio: atraso comprovado", () => {
  const cen = { ...CENARIO_VIGENTE, atrasoComprovadoNivel0: true };
  it("8 dias úteis: nível 0, reenvio ou reembolso, sem teto até o valor do pedido", () => {
    const r = decidirNivel(entrada("atraso", { diasUteisAtraso: 8, valorPedido: 650 }, { valorAcao: 650, cenario: cen }));
    expect(r).toMatchObject({ nivel: 0, ferramenta: "reenviar_produto", ferramentasAdicionais: ["reembolsar"], acaoSemTeto: true });
  });
  it("extravio confirmado: nível 0", () => {
    expect(decidirNivel(entrada("atraso", { statusEntrega: "extraviado", valorPedido: 120 }, { valorAcao: 120, cenario: cen })).nivel).toBe(0);
  });
  it("7 dias úteis (borda): continua abrindo chamado", () => {
    expect(decidirNivel(entrada("atraso", { diasUteisAtraso: 7 }, { cenario: cen })).ferramenta).toBe("abrir_chamado_transportadora");
  });
  it("valor acima do valor do pedido: nível 1", () => {
    expect(decidirNivel(entrada("atraso", { diasUteisAtraso: 9, valorPedido: 120 }, { valorAcao: 120.01, cenario: cen })).nivel).toBe(1);
  });
  it("rastreio de pedido com atraso comprovado segue a mesma regra", () => {
    expect(decidirNivel(entrada("rastreio", { diasUteisAtraso: 12, valorPedido: 120 }, { valorAcao: 120, cenario: cen })).nivel).toBe(0);
  });
  it("desligado (vigente): nível 1", () => {
    expect(decidirNivel(entrada("atraso", { diasUteisAtraso: 8 }, { valorAcao: 50 })).nivel).toBe(1);
  });
});

describe("princípio: troca de fragrância com coleta reversa", () => {
  const cen = { ...CENARIO_VIGENTE, trocaFragranciaNivel0: true };
  const ok = { statusEntrega: "entregue" as const, diasDesdeRecebimento: 30, trocasNoPedido: 0, valorPedido: 150 };
  it("até 30 dias (borda) e sem troca anterior: nível 0, troca com coleta reversa e conferência do CD", () => {
    const r = decidirNivel(entrada("troca_fragrancia", ok, { valorAcao: 150, cenario: cen }));
    expect(r).toMatchObject({ nivel: 0, ferramenta: "trocar_produto", acao: "troca_com_coleta_reversa" });
    expect(r.justificativa).toContain("CD conferir até 20%");
  });
  it("31 dias, troca anterior ou trocas desconhecidas: nível 1", () => {
    expect(decidirNivel(entrada("troca_fragrancia", { ...ok, diasDesdeRecebimento: 31 }, { valorAcao: 150, cenario: cen })).nivel).toBe(1);
    expect(decidirNivel(entrada("troca_fragrancia", { ...ok, trocasNoPedido: 1 }, { valorAcao: 150, cenario: cen })).nivel).toBe(1);
    expect(decidirNivel(entrada("troca_fragrancia", { ...ok, trocasNoPedido: undefined }, { valorAcao: 150, cenario: cen })).nivel).toBe(1);
  });
  it("troca não é direito sem teto: acima de R$ 200 (limite de troca) vai para nível 1", () => {
    expect(decidirNivel(entrada("troca_fragrancia", { ...ok, valorPedido: 260 }, { valorAcao: 260, cenario: cen })).nivel).toBe(1);
  });
  it("desligado (vigente): nível 1", () => {
    expect(decidirNivel(entrada("troca_fragrancia", ok, { valorAcao: 150 })).nivel).toBe(1);
  });
});

describe("princípio: Reclame Aqui separa ação e resposta", () => {
  const cen = { ...CENARIO_VIGENTE, reclameAquiSeparaResposta: true };
  it("ligado: a ação segue o motivo (nível 0) e só a resposta precisa de aprovação", () => {
    const r = decidirNivel(entrada("cupom", {}, { canal: "reclame_aqui", cenario: cen }));
    expect(r).toMatchObject({ nivel: 0, nivelAcao: 0, aprovacaoResposta: true, precisaAprovacaoDe: "supervisor" });
    expect(r.justificativa).toContain("Reclame Aqui: ação e resposta separadas");
  });
  it("ligado: motivo de nível 1 continua nível 1 na ação", () => {
    expect(decidirNivel(entrada("cancelamento", { separado: true }, { canal: "reclame_aqui", cenario: cen }))).toMatchObject({ nivelAcao: 1, aprovacaoResposta: true });
  });
  it("vigente: a conversa inteira sobe para nível 1", () => {
    expect(decidirNivel(entrada("cupom", {}, { canal: "reclame_aqui" }))).toMatchObject({ nivel: 1, nivelAcao: 1, aprovacaoResposta: true });
  });
  it("fora do Reclame Aqui não há aprovação de resposta", () => {
    expect(decidirNivel(entrada("cupom", {}, { cenario: cen }))).toMatchObject({ nivelAcao: 0, aprovacaoResposta: false });
  });
});

describe("padrão: os princípios juntos", () => {
  it("atraso comprovado no Reclame Aqui: ação no nível 0 e resposta aprovada", () => {
    const r = decidirNivel({
      motivo: "atraso",
      confiancaClassificador: 0.9,
      fatos: { statusEntrega: "em_transito", valorPedido: 220, diasUteisAtraso: 10 },
      valorAcao: 220,
      canal: "reclame_aqui",
    });
    expect(r).toMatchObject({ nivelAcao: 0, aprovacaoResposta: true, acaoSemTeto: true, ferramenta: "reenviar_produto" });
  });
  it("freio de R$ 3.000 do padrão segura a ação sem teto que passaria do dia", () => {
    const fatos = { statusEntrega: "aguardando_separacao" as const, separado: false, valorPedido: 400 };
    expect(decidirNivel({ motivo: "cancelamento", confiancaClassificador: 0.9, fatos, valorAcao: 400, canal: "email", gastoAutonomoHojeRs: 2600 }).nivel).toBe(0);
    expect(decidirNivel({ motivo: "cancelamento", confiancaClassificador: 0.9, fatos, valorAcao: 400, canal: "email", gastoAutonomoHojeRs: 2600.01 }).nivel).toBe(1);
  });
  it("confiança abaixo de 0,7 sobe a ação sem teto para nível 1", () => {
    const fatos = { statusEntrega: "aguardando_separacao" as const, separado: false, valorPedido: 400 };
    const r = decidirNivel({ motivo: "cancelamento", confiancaClassificador: 0.69, fatos, valorAcao: 400, canal: "email" });
    expect(r.nivel).toBe(1);
  });
});
