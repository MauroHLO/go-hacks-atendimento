import { describe, expect, it } from "vitest";
import { consumirTodos, DESLOCAMENTO_BRASILIA_MS, DIA_MS, LimitadorJanela, MINUTO_MS } from "./index";

function relogio(t = 0) {
  const r = { t, agora: () => r.t };
  return r;
}

describe("LimitadorJanela", () => {
  it("permite até o limite e barra a seguinte", () => {
    const r = relogio();
    const l = new LimitadorJanela({ limite: 3, janelaMs: MINUTO_MS, agora: r.agora });
    expect([1, 2, 3].map(() => l.consumir("a").ok)).toEqual([true, true, true]);
    expect(l.consumir("a")).toEqual({ ok: false, restante: 0, reiniciaEm: MINUTO_MS });
  });

  it("informa o restante", () => {
    const l = new LimitadorJanela({ limite: 2, janelaMs: MINUTO_MS, agora: relogio().agora });
    expect(l.consumir("a").restante).toBe(1);
    expect(l.consumir("a").restante).toBe(0);
  });

  it("a virada da janela libera", () => {
    const r = relogio(10);
    const l = new LimitadorJanela({ limite: 1, janelaMs: MINUTO_MS, agora: r.agora });
    expect(l.consumir("a").ok).toBe(true);
    expect(l.consumir("a").ok).toBe(false);
    r.t = MINUTO_MS - 1;
    expect(l.consumir("a").ok).toBe(false);
    r.t = MINUTO_MS;
    expect(l.consumir("a").ok).toBe(true);
  });

  it("chaves são independentes", () => {
    const l = new LimitadorJanela({ limite: 1, janelaMs: MINUTO_MS, agora: relogio().agora });
    expect(l.consumir("a").ok).toBe(true);
    expect(l.consumir("b").ok).toBe(true);
    expect(l.consumir("a").ok).toBe(false);
  });

  it("verificar não consome", () => {
    const l = new LimitadorJanela({ limite: 1, janelaMs: MINUTO_MS, agora: relogio().agora });
    expect(l.verificar("a").ok).toBe(true);
    expect(l.verificar("a").ok).toBe(true);
    expect(l.consumir("a").ok).toBe(true);
    expect(l.verificar("a").ok).toBe(false);
  });

  it("dia alinhado à meia-noite de Brasília (03:00 UTC)", () => {
    const meiaNoiteBrasilia = Date.UTC(2026, 9, 31, 3, 0, 0);
    const r = relogio(meiaNoiteBrasilia - 1);
    const l = new LimitadorJanela({ limite: 1, janelaMs: DIA_MS, deslocamentoMs: DESLOCAMENTO_BRASILIA_MS, agora: r.agora });
    expect(l.consumir("g").ok).toBe(true);
    expect(l.consumir("g").reiniciaEm).toBe(meiaNoiteBrasilia);
    r.t = meiaNoiteBrasilia;
    expect(l.consumir("g").ok).toBe(true);
  });

  it("memória limitada: poda chaves expiradas e, se preciso, as mais antigas", () => {
    const r = relogio();
    const l = new LimitadorJanela({ limite: 5, janelaMs: MINUTO_MS, maxChaves: 3, agora: r.agora });
    ["a", "b", "c"].forEach((k) => l.consumir(k));
    r.t = MINUTO_MS; // janela nova: a, b, c expiraram
    l.consumir("d");
    expect(l.tamanho).toBe(1);
    ["e", "f", "g"].forEach((k) => l.consumir(k));
    expect(l.tamanho).toBe(3);
    // "d" era a mais antiga na janela atual e foi removida
    expect(l.verificar("d").restante).toBe(5);
  });

  it("limite zero barra tudo", () => {
    const l = new LimitadorJanela({ limite: 0, janelaMs: MINUTO_MS, agora: relogio().agora });
    expect(l.consumir("a").ok).toBe(false);
  });

  it.each([
    [{ limite: -1, janelaMs: MINUTO_MS }],
    [{ limite: 1.5, janelaMs: MINUTO_MS }],
    [{ limite: 1, janelaMs: 0 }],
    [{ limite: 1, janelaMs: Number.NaN }],
  ])("opções inválidas lançam RangeError: %o", (o) => {
    expect(() => new LimitadorJanela(o)).toThrow(RangeError);
  });
});

describe("consumirTodos", () => {
  it("só consome se todos permitirem", () => {
    const r = relogio();
    const porIp = new LimitadorJanela({ limite: 5, janelaMs: MINUTO_MS, agora: r.agora });
    const global = new LimitadorJanela({ limite: 1, janelaMs: DIA_MS, agora: r.agora });
    const itens = [
      { limitador: porIp, chave: "1.2.3.4", nome: "ip_minuto" },
      { limitador: global, chave: "global", nome: "diario" },
    ];
    expect(consumirTodos(itens)).toEqual({ ok: true });
    expect(consumirTodos(itens)).toEqual({ ok: false, nome: "diario", reiniciaEm: DIA_MS });
    // o barrado pelo teto global não gastou a cota por IP
    expect(porIp.verificar("1.2.3.4").restante).toBe(4);
  });

  it("devolve o primeiro limite que barrou", () => {
    const r = relogio();
    const a = new LimitadorJanela({ limite: 0, janelaMs: MINUTO_MS, agora: r.agora });
    const b = new LimitadorJanela({ limite: 0, janelaMs: DIA_MS, agora: r.agora });
    const res = consumirTodos([
      { limitador: a, chave: "x", nome: "ip_minuto" },
      { limitador: b, chave: "x", nome: "diario" },
    ]);
    expect(res).toMatchObject({ ok: false, nome: "ip_minuto" });
  });
});
