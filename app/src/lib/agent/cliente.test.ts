import { describe, expect, it } from "vitest";
import { configDoAmbiente, FalhaIA } from "./cliente";
import { clienteFalso, respostaChat, respostaJev } from "./fetch-falso";

const PERGUNTA = { motivo: { type: "choice" as const, criteria: { avaria: "chegou quebrado", atraso: "não chegou" } } };

describe("configuração", () => {
  it("lê as três variáveis e tira a barra final da URL", () => {
    expect(configDoAmbiente({ AI_PROXY_BASE_URL: "https://x/v1/", AI_PROXY_API_KEY: "k", AI_PROXY_MODEL: "m" })).toEqual({ baseUrl: "https://x/v1", apiKey: "k", modelo: "m" });
  });
  it("falta variável → FalhaIA config", () => {
    expect(() => configDoAmbiente({ AI_PROXY_BASE_URL: "https://x/v1", AI_PROXY_MODEL: "m" })).toThrow(FalhaIA);
  });
});

describe("Jev", () => {
  it("POST /systemone com state e questions, chave no Authorization; lê custo e tokens", async () => {
    const { ia, chamadas } = clienteFalso({ jev: [{ json: { model: "jev", answers: { motivo: { type: "choice", choice: "avaria", confidence: 1, probabilities: { avaria: 1 } } }, usage: { input_tokens: 10, output_tokens: 2, estimated_cost_usd: 0.001 } } }] });
    const r = await ia.jev("Cliente: chegou quebrado", PERGUNTA);
    expect(chamadas[0].url).toBe("https://proxy.teste/v1/systemone");
    expect(chamadas[0].corpo).toEqual({ state: "Cliente: chegou quebrado", questions: PERGUNTA });
    expect(chamadas[0].headers.Authorization).toBe("Bearer chave-de-teste");
    expect(r.uso).toEqual({ entrada: 10, saida: 2, custoUsd: 0.001 });
  });

  it.each([
    ["HTTP 429", { status: 429, json: { error: "limite" } }, "http"],
    ["HTTP 500", { status: 500, json: {} }, "http"],
    ["formato inesperado", { json: { answers: { motivo: { type: "choice" } } } }, "resposta_invalida"],
    ["pergunta sem resposta", { json: { answers: {} } }, "resposta_invalida"],
  ] as const)("%s → FalhaIA %s", async (_n, resp, tipo) => {
    const { ia } = clienteFalso({ jev: [resp] });
    await expect(ia.jev("x", PERGUNTA)).rejects.toMatchObject({ tipo });
  });

  it("status HTTP vai na falha", async () => {
    const { ia } = clienteFalso({ jev: [{ status: 429 }] });
    await expect(ia.jev("x", PERGUNTA)).rejects.toMatchObject({ tipo: "http", status: 429 });
  });

  it("timeout aborta a requisição → FalhaIA timeout", async () => {
    const { ia } = clienteFalso({ jev: [{ atraso: "pendurar" }] });
    await expect(ia.jev("x", PERGUNTA, 20)).rejects.toMatchObject({ tipo: "timeout" });
  });

  it("erro de rede → FalhaIA rede", async () => {
    const { ia } = clienteFalso({ jev: [new TypeError("fetch failed")] });
    await expect(ia.jev("x", PERGUNTA)).rejects.toMatchObject({ tipo: "rede" });
  });

  it("a mensagem de erro nunca traz a chave nem o texto", async () => {
    const { ia } = clienteFalso({ jev: [{ status: 401 }] });
    const e = await ia.jev("texto-secreto-do-cliente", PERGUNTA).catch((x) => x as Error);
    expect(String(e)).not.toContain("chave-de-teste");
    expect(String(e)).not.toContain("texto-secreto");
  });

  it("aceita a resposta completa do classificador", async () => {
    const { ia } = clienteFalso({ jev: [{ json: respostaJev("avaria") }] });
    const r = await ia.jev("x", { motivo: PERGUNTA.motivo });
    expect(r.resposta.answers.motivo).toMatchObject({ choice: "avaria" });
  });
});

describe("chat", () => {
  it("POST /chat/completions com o modelo configurado; custo não informado", async () => {
    const { ia, chamadas } = clienteFalso({ chat: [{ json: respostaChat("Olá!") }] });
    const r = await ia.chat([{ role: "user", content: "oi" }], { maxTokens: 50 });
    expect(chamadas[0].url).toBe("https://proxy.teste/v1/chat/completions");
    expect(chamadas[0].corpo).toMatchObject({ model: "modelo-teste", max_tokens: 50 });
    expect(r).toMatchObject({ texto: "Olá!", uso: { entrada: 50, saida: 10, custoUsd: null } });
  });
  it("sem choices → resposta_invalida", async () => {
    const { ia } = clienteFalso({ chat: [{ json: { choices: [] } }] });
    await expect(ia.chat([{ role: "user", content: "oi" }])).rejects.toMatchObject({ tipo: "resposta_invalida" });
  });
});
