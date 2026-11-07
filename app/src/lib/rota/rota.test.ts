import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { RAZAO_FALHA, resultadoFalha, type Processar, type ResultadoGravado } from "./contrato";
import { LimitadorJanela, MINUTO_MS, DIA_MS } from "../limites";
import {
  criarHandler,
  criarLimitesPadrao,
  ipDaRequisicao,
  LIMITE_CORPO_BYTES,
  LIMITE_DIARIO_GLOBAL_PADRAO,
  LIMITE_IP_DIA,
  LIMITE_IP_MINUTO,
  lerLimiteGlobal,
  MENSAGEM_LIMITE,
  mesmaOrigem,
  type DepsRota,
  type Limites,
} from "./handler";

// ---------- apoio ----------

const ORIGEM = "http://localhost:3000";
const TRECHO = "frase-unica-da-rota-qwz";
const MENSAGEM = `Oi, onde está meu pedido? ${TRECHO}`;
const CONTEXTO = { statusEntrega: "em_transito", canal: "whatsapp", valor: 89.9, seq: 1 };

// Pipeline falso: o pipeline real (lib/agent) é injetado e testado à parte.
function processarFalso(): Processar {
  return async () => ({
    nivel: 0,
    razoes: ["rastreio com pedido em trânsito"],
    motivoPrincipal: "rastreio",
    resposta: "Seu pedido está em trânsito.",
    classificacaoValida: true,
    falha: null,
    chamadas: [{}, {}],
    tentativasRedacao: 1,
  });
}

function limites(r: { t: number }, global = 300): Limites {
  return criarLimitesPadrao({ LIMITE_DIARIO_GLOBAL: String(global) }, () => r.t);
}

function montar(extra: Partial<DepsRota> = {}) {
  const relogio = { t: Date.UTC(2026, 9, 31, 15, 0, 0) };
  const logs: string[] = [];
  const handler = criarHandler({
    processar: processarFalso(),
    limites: limites(relogio),
    modelo: "openai/gpt-oss-20b",
    agora: () => relogio.t,
    log: (l) => logs.push(l),
    ...extra,
  });
  return { handler, logs, relogio };
}

function requisicao(
  corpo: unknown = { mensagem: MENSAGEM, contexto: CONTEXTO },
  opcoes: { headers?: Record<string, string>; bruto?: string | ReadableStream<Uint8Array> } = {},
): Request {
  const headers = { origin: ORIGEM, host: "localhost:3000", "content-type": "application/json", "x-real-ip": "10.0.0.1", ...opcoes.headers };
  const body = opcoes.bruto ?? JSON.stringify(corpo);
  return new Request(`${ORIGEM}/api/agent`, { method: "POST", headers, body, duplex: "half" } as RequestInit);
}

async function corpoDe(res: Response) {
  return { status: res.status, json: (await res.json()) as Record<string, unknown>, headers: res.headers };
}

// Espiões em todos os métodos de console, para o teste de privacidade dos logs.
let espioes: MockInstance[] = [];
beforeEach(() => {
  espioes = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => espioes.forEach((e) => e.mockRestore()));
function tudoQueFoiLogado(logs: string[]): string {
  return [...logs, ...espioes.flatMap((e) => e.mock.calls.map((c) => c.map(String).join(" ")))].join("\n");
}

// ---------- testes ----------

describe("sucesso", () => {
  it("200 no formato do pipeline, sem cache e sem ecoar a mensagem", async () => {
    const { handler, logs } = montar();
    const { status, json, headers } = await corpoDe(await handler(requisicao()));
    expect(status).toBe(200);
    expect(headers.get("cache-control")).toBe("no-store");
    expect(headers.get("content-type")).toContain("application/json");
    expect(json).toMatchObject({ nivel: 0, motivoPrincipal: "rastreio", falha: null, modelo: "openai/gpt-oss-20b" });
    for (const campo of ["razoes", "resposta", "classificacaoValida", "chamadas", "tentativasRedacao"]) {
      expect(json).toHaveProperty(campo);
    }
    expect(JSON.stringify(json)).not.toContain(TRECHO);
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0])).toEqual({ nivel: 0, falha: null, ms: 0, chamadas: 2, tentativasRedacao: 1 });
  });

  it("mensagem com espaços nas pontas é aceita (trim)", async () => {
    const { handler } = montar();
    const res = await handler(requisicao({ mensagem: "   onde está meu pedido?   ", contexto: CONTEXTO }));
    expect(res.status).toBe(200);
  });
});

describe("origem", () => {
  it.each<[string, Record<string, string>]>([
    ["sem Origin", { origin: "" }],
    ["outro site", { origin: "https://outro.example.com" }],
    ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site" }],
    ["Origin inválida", { origin: "não é url" }],
  ])("%s → 403", async (_nome, headers) => {
    const { handler } = montar();
    const req = requisicao(undefined, { headers });
    if (headers.origin === "") req.headers.delete("origin");
    const { status, json } = await corpoDe(await handler(req));
    expect(status).toBe(403);
    expect(json).toEqual({ erro: "origem não permitida" });
  });

  it("mesma origem atrás de proxy (x-forwarded-host)", () => {
    const h = new Headers({ origin: "https://demo.vercel.app", host: "interno:3000", "x-forwarded-host": "demo.vercel.app" });
    expect(mesmaOrigem(h)).toBe(true);
    expect(mesmaOrigem(new Headers({ origin: "https://demo.vercel.app", host: "demo.vercel.app", "sec-fetch-site": "same-origin" }))).toBe(true);
  });
});

describe("tamanho", () => {
  it("Content-Length acima de 10 KB → 413", async () => {
    const { handler } = montar();
    const req = requisicao(undefined, { headers: { "content-length": String(LIMITE_CORPO_BYTES + 1) } });
    const { status, json } = await corpoDe(await handler(req));
    expect(status).toBe(413);
    expect(json).toEqual({ erro: "mensagem grande demais" });
  });

  it("corpo grande sem Content-Length (em partes) → 413", async () => {
    const { handler } = montar();
    const bloco = new TextEncoder().encode("a".repeat(4096));
    let enviados = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (enviados++ < 4) c.enqueue(bloco);
        else c.close();
      },
    });
    const { status } = await corpoDe(await handler(requisicao(undefined, { bruto: stream })));
    expect(status).toBe(413);
  });

  it("mensagem de 2.001 caracteres → 400", async () => {
    const { handler } = montar();
    const res = await handler(requisicao({ mensagem: "a".repeat(2001), contexto: CONTEXTO }));
    expect(res.status).toBe(400);
  });

  it("mensagem de 2.000 caracteres passa", async () => {
    const { handler } = montar();
    const res = await handler(requisicao({ mensagem: "a".repeat(2000), contexto: CONTEXTO }));
    expect(res.status).toBe(200);
  });
});

describe("validação", () => {
  const casos: [string, unknown][] = [
    ["mensagem vazia", { mensagem: "   ", contexto: CONTEXTO }],
    ["mensagem ausente", { contexto: CONTEXTO }],
    ["contexto ausente", { mensagem: "oi" }],
    ["status inválido", { mensagem: "oi", contexto: { ...CONTEXTO, statusEntrega: "perdido" } }],
    ["canal inválido", { mensagem: "oi", contexto: { ...CONTEXTO, canal: "telefone" } }],
    ["seq 0", { mensagem: "oi", contexto: { ...CONTEXTO, seq: 0 } }],
    ["seq 1,5", { mensagem: "oi", contexto: { ...CONTEXTO, seq: 1.5 } }],
    ["seq 21", { mensagem: "oi", contexto: { ...CONTEXTO, seq: 21 } }],
    ["valor negativo", { mensagem: "oi", contexto: { ...CONTEXTO, valor: -1 } }],
    ["valor acima de 10.000", { mensagem: "oi", contexto: { ...CONTEXTO, valor: 10_001 } }],
    ["valor como texto", { mensagem: "oi", contexto: { ...CONTEXTO, valor: "100" } }],
    ["corpo não é objeto", [1, 2, 3]],
  ];
  it.each(casos)("%s → 400 genérico", async (_nome, corpo) => {
    const { handler } = montar();
    const { status, json } = await corpoDe(await handler(requisicao(corpo)));
    expect(status).toBe(400);
    expect(json).toEqual({ erro: "entrada inválida" });
  });

  it("JSON quebrado → 400 sem ecoar o corpo", async () => {
    const { handler } = montar();
    const { status, json } = await corpoDe(await handler(requisicao(undefined, { bruto: `{"mensagem": "${TRECHO}"` })));
    expect(status).toBe(400);
    expect(JSON.stringify(json)).not.toContain(TRECHO);
  });
});

describe("limites", () => {
  it("valores padrão", () => {
    expect([LIMITE_IP_MINUTO, LIMITE_IP_DIA, LIMITE_DIARIO_GLOBAL_PADRAO]).toEqual([10, 100, 300]);
    expect(lerLimiteGlobal({})).toBe(300);
    expect(lerLimiteGlobal({ LIMITE_DIARIO_GLOBAL: "50" })).toBe(50);
    expect(lerLimiteGlobal({ LIMITE_DIARIO_GLOBAL: "abc" })).toBe(300);
    expect(lerLimiteGlobal({ LIMITE_DIARIO_GLOBAL: "-5" })).toBe(300);
  });

  it("11ª requisição no mesmo minuto → 429 ip_minuto; a virada libera; outro IP não é afetado", async () => {
    const { handler, relogio } = montar();
    for (let i = 0; i < 10; i++) expect((await handler(requisicao())).status).toBe(200);
    const { status, json } = await corpoDe(await handler(requisicao()));
    expect(status).toBe(429);
    expect(json).toMatchObject({ erro: MENSAGEM_LIMITE, limite: "ip_minuto" });
    expect(typeof json.reiniciaEm).toBe("string");
    expect((await handler(requisicao(undefined, { headers: { "x-real-ip": "10.0.0.2" } }))).status).toBe(200);
    relogio.t += MINUTO_MS;
    expect((await handler(requisicao())).status).toBe(200);
  });

  it("limite diário por IP → 429 ip_dia", async () => {
    const r = { t: 0 };
    const lim: Limites = {
      ipMinuto: new LimitadorJanela({ limite: 1000, janelaMs: MINUTO_MS, agora: () => r.t }),
      ipDia: new LimitadorJanela({ limite: 2, janelaMs: DIA_MS, agora: () => r.t }),
      global: new LimitadorJanela({ limite: 1000, janelaMs: DIA_MS, agora: () => r.t }),
    };
    const { handler } = montar({ limites: lim });
    await handler(requisicao());
    await handler(requisicao());
    expect((await corpoDe(await handler(requisicao()))).json).toMatchObject({ limite: "ip_dia" });
  });

  it("teto diário global → 429 diario, com a mensagem amigável (não é nível 2)", async () => {
    const r = { t: 0 };
    const { handler } = montar({ limites: limites(r, 1) });
    expect((await handler(requisicao())).status).toBe(200);
    const { status, json } = await corpoDe(await handler(requisicao(undefined, { headers: { "x-real-ip": "10.0.0.9" } })));
    expect(status).toBe(429);
    expect(json).toMatchObject({ erro: MENSAGEM_LIMITE, limite: "diario" });
    expect(json).not.toHaveProperty("nivel");
  });

  it("requisição inválida não consome cota", async () => {
    const r = { t: 0 };
    const { handler } = montar({ limites: limites(r, 1) });
    for (let i = 0; i < 5; i++) expect((await handler(requisicao({ mensagem: "" }))).status).toBe(400);
    expect((await handler(requisicao())).status).toBe(200);
  });

  it("IP: x-real-ip, depois x-vercel-forwarded-for, depois x-forwarded-for", () => {
    expect(ipDaRequisicao(new Headers({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(ipDaRequisicao(new Headers({ "x-vercel-forwarded-for": "3.3.3.3, 9.9.9.9", "x-forwarded-for": "2.2.2.2" }))).toBe("3.3.3.3");
    expect(ipDaRequisicao(new Headers({ "x-forwarded-for": "2.2.2.2, 8.8.8.8" }))).toBe("2.2.2.2");
    expect(ipDaRequisicao(new Headers())).toBe("desconhecido");
  });
});

describe("falhas", () => {
  it("falha do modelo: 200, nível 2, formato do pipeline", async () => {
    const { handler } = montar({ processar: async () => resultadoFalha("rate_limit") });
    const { status, json } = await corpoDe(await handler(requisicao()));
    expect(status).toBe(200);
    expect(json).toMatchObject({ nivel: 2, razoes: [RAZAO_FALHA], falha: { tipo: "rate_limit" }, resposta: null });
  });

  it("exceção na própria rota (fora do pipeline): 200, nível 2, falha interno, sem texto do erro", async () => {
    const { handler, logs } = montar({
      processar: async () => {
        throw new TypeError(`erro com ${TRECHO}`);
      },
    });
    const { status, json } = await corpoDe(await handler(requisicao()));
    expect(status).toBe(200);
    expect(json).toMatchObject({ nivel: 2, razoes: [RAZAO_FALHA], falha: { tipo: "interno" }, resposta: null, modelo: "openai/gpt-oss-20b" });
    expect(JSON.stringify(json)).not.toContain(TRECHO);
    expect(JSON.parse(logs[0])).toEqual({ nivel: 2, falha: "interno", ms: 0, chamadas: 0, tentativasRedacao: 0 });
  });

  it("falha do modelo com contingência injetada: devolve a resposta gravada", async () => {
    const gravada: ResultadoGravado = { ...resultadoFalha("timeout"), nivel: 0, falha: null, contingencia: { modelo: "gravado" } };
    const { handler, logs } = montar({ processar: async () => resultadoFalha("rate_limit"), contingencia: async () => gravada });
    const { json } = await corpoDe(await handler(requisicao()));
    expect(json).toMatchObject({ nivel: 0, modelo: "gravado" });
    expect(JSON.parse(logs[0])).toMatchObject({ falha: "gravada_rate_limit" });
  });

  it("log que lança não derruba a resposta", async () => {
    const { handler } = montar({
      log: () => {
        throw new Error("log quebrado");
      },
    });
    expect((await handler(requisicao())).status).toBe(200);
  });
});

describe("privacidade dos logs e das respostas", () => {
  const cenarios: [string, Partial<DepsRota>, () => Request][] = [
    ["sucesso", {}, () => requisicao()],
    ["falha do modelo", { processar: async () => resultadoFalha("timeout") }, () => requisicao()],
    ["exceção na rota", { processar: async () => { throw new Error(`rota: ${TRECHO}`); } }, () => requisicao()],
    ["entrada inválida", {}, () => requisicao({ mensagem: MENSAGEM, contexto: { ...CONTEXTO, seq: 0 } })],
    ["origem", {}, () => requisicao(undefined, { headers: { origin: "https://x.example.com" } })],
  ];

  it.each(cenarios)("%s: uma linha de log só com nivel, falha, ms, chamadas e tentativasRedacao", async (_nome, extra, req) => {
    const { handler, logs } = montar(extra);
    const res = await handler(req());
    const texto = await res.text();
    expect(texto).not.toContain(TRECHO);
    expect(logs).toHaveLength(1);
    expect(Object.keys(JSON.parse(logs[0])).sort()).toEqual(["chamadas", "falha", "ms", "nivel", "tentativasRedacao"]);
    const logado = tudoQueFoiLogado(logs);
    expect(logado).not.toContain(TRECHO);
    expect(logado).not.toContain("10.0.0.1"); // sem IP
    expect(logado).not.toContain("onde está meu pedido");
  });

  it("log padrão usa console.log com a mesma linha", async () => {
    const relogio = { t: 0 };
    const handler = criarHandler({ processar: processarFalso(), limites: limites(relogio), agora: () => relogio.t });
    await handler(requisicao());
    const linhas = espioes[0].mock.calls.map((c) => String(c[0]));
    expect(linhas).toHaveLength(1);
    expect(JSON.parse(linhas[0])).toEqual({ nivel: 0, falha: null, ms: 0, chamadas: 2, tentativasRedacao: 1 });
  });
});
