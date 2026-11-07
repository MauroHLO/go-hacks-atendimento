import { describe, expect, it } from "vitest";
import { classificar, montarState, PERGUNTAS } from "./classificador";
import { clienteFalso, respostaJev } from "./fetch-falso";
import { DESCRICAO_MOTIVO, SINAIS_TEXTO } from "./taxonomia";

const semEspera = { esperar: async () => {} };

describe("perguntas ao Jev", () => {
  it("motivo (choice) com a taxonomia, urgência (score) e os seis noul", () => {
    expect(PERGUNTAS.motivo).toEqual({ type: "choice", criteria: DESCRICAO_MOTIVO });
    expect(PERGUNTAS.urgencia).toEqual({ type: "score", criteria: ["baixa", "media", "alta"] });
    for (const k of Object.keys(SINAIS_TEXTO)) expect(PERGUNTAS[k]).toMatchObject({ type: "noul" });
    expect(Object.keys(DESCRICAO_MOTIVO)).not.toContain("sem_demanda");
  });
});

describe("mascaramento", () => {
  it("o texto enviado ao Jev não tem CPF, cartão, telefone nem e-mail", async () => {
    const { ia, chamadas } = clienteFalso({ jev: [{ json: respostaJev("cobranca_duplicada") }] });
    await classificar(ia, {
      mensagensCliente: ["Meu CPF é 123.456.789-00, cartão 1234 5678 9012 3456", "liga (11) 91234-5678 ou ana@exemplo.com"],
      assunto: "Cobrança 123.456.789-00",
      canal: "email",
    });
    const state = String(chamadas[0].corpo.state);
    expect(state).toContain("[CPF]");
    expect(state).toContain("[CARTAO]");
    expect(state).toContain("[TELEFONE]");
    expect(state).toContain("[EMAIL]");
    expect(state).not.toMatch(/123\.456|1234 5678|91234|ana@/);
  });

  it("state limitado às últimas mensagens quando passa do tamanho", () => {
    const s = montarState({ mensagensCliente: Array.from({ length: 100 }, (_, i) => `mensagem ${i} ${"x".repeat(80)}`) });
    expect(s.length).toBeLessThanOrEqual(4000);
    expect(s).toContain("mensagem 99");
  });
});

describe("regras do código sobre a saída do Jev", () => {
  it("sem mensagem do cliente: sem_demanda sem chamar o Jev", async () => {
    const { ia, chamadas } = clienteFalso({ jev: [{ json: respostaJev("rastreio") }] });
    const r = await classificar(ia, { mensagensCliente: ["  "] });
    expect(r).toMatchObject({ valida: true, motivo: "sem_demanda", semMensagemDoCliente: true });
    expect(chamadas).toHaveLength(0);
  });

  it("guarda motivo, confiança, probabilidades, urgência e sinais; custo do proxy", async () => {
    const { ia } = clienteFalso({ jev: [{ json: respostaJev("atraso", { confianca: 0.82, urgencia: 2, sinais: { cliente_irritado: 0.9, ameaca_reclame_aqui_ou_procon: 0.7 } }) }] });
    const r = await classificar(ia, { mensagensCliente: ["cadê meu pedido, vou no Procon"] });
    expect(r).toMatchObject({ valida: true, motivo: "atraso", motivoJev: "atraso", confianca: 0.82, urgencia: "alta" });
    expect(r.flags).toMatchObject({ cliente_irritado: true, ameaca_reclame_aqui_ou_procon: true, reacao_adversa: false });
    expect(r.probabilidades).toEqual({ atraso: 0.82 });
    expect(r.uso.custoUsd).toBe(0.00004);
  });

  it("reação adversa >= 0,5 prevalece sobre o motivo escolhido (segurança)", async () => {
    const { ia } = clienteFalso({ jev: [{ json: respostaJev("troca_fragrancia", { confianca: 0.6, sinais: { reacao_adversa: 0.8 } }) }] });
    const r = await classificar(ia, { mensagensCliente: ["quero trocar, me deu coceira"] });
    expect(r).toMatchObject({ motivo: "reacao_adversa", motivoJev: "troca_fragrancia", confianca: 0.8, mencaoSaude: true });
  });

  it("menção de saúde também pelo detector de palavras", async () => {
    const { ia } = clienteFalso({ jev: [{ json: respostaJev("duvida_produto") }] });
    const r = await classificar(ia, { mensagensCliente: ["posso usar na gravidez?"] });
    expect(r.mencaoSaude).toBe(true);
  });

  it("motivo fora da taxonomia → outro com confiança 0 (vai para nível 1 no motor)", async () => {
    const { ia } = clienteFalso({ jev: [{ json: respostaJev("inventado") }] });
    const r = await classificar(ia, { mensagensCliente: ["oi"] });
    expect(r).toMatchObject({ valida: true, motivo: "outro", confianca: 0 });
  });
});

describe("falhas", () => {
  it("HTTP 429: espera e tenta mais uma vez", async () => {
    const esperas: number[] = [];
    const { ia, chamadas } = clienteFalso({ jev: [{ status: 429 }, { json: respostaJev("rastreio") }] });
    const r = await classificar(ia, { mensagensCliente: ["onde está?"] }, { esperar: async (ms) => void esperas.push(ms) });
    expect(r).toMatchObject({ valida: true, motivo: "rastreio", tentativas: 2 });
    expect(chamadas).toHaveLength(2);
    expect(esperas).toEqual([1500]);
  });

  it("429 duas vezes: inválida, com status", async () => {
    const { ia } = clienteFalso({ jev: [{ status: 429 }] });
    expect(await classificar(ia, { mensagensCliente: ["oi"] }, semEspera)).toMatchObject({ valida: false, falha: "http", falhaStatus: 429, tentativas: 2 });
  });

  it("timeout de 10 s: inválida sem repetir", async () => {
    const { ia, chamadas } = clienteFalso({ jev: [{ atraso: "pendurar" }] });
    const r = await classificar(ia, { mensagensCliente: ["oi"] }, { ...semEspera, timeoutMs: 20 });
    expect(r).toMatchObject({ valida: false, falha: "timeout", confianca: 0 });
    expect(chamadas).toHaveLength(1);
  });

  it("HTTP 400 (erro nosso) não repete", async () => {
    const { ia, chamadas } = clienteFalso({ jev: [{ status: 400 }] });
    expect(await classificar(ia, { mensagensCliente: ["oi"] }, semEspera)).toMatchObject({ valida: false, falha: "http", falhaStatus: 400 });
    expect(chamadas).toHaveLength(1);
  });

  it("resposta sem um dos noul: inválida", async () => {
    const j = respostaJev("rastreio") as { answers: Record<string, unknown> };
    delete j.answers.cliente_irritado;
    const { ia } = clienteFalso({ jev: [{ json: j }] });
    expect(await classificar(ia, { mensagensCliente: ["oi"] }, semEspera)).toMatchObject({ valida: false, falha: "resposta_invalida" });
  });
});
