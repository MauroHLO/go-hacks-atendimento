import { describe, expect, it } from "vitest";
import { linhasDaFicha, montarPainel } from "./dados";
import { montarContexto } from "../contexto";

describe("montarPainel", () => {
  const d = montarPainel();

  it("fila: as 65 conversas gravadas, com ficha e em ordem de prioridade (SLA estourado primeiro)", () => {
    expect(d.fila.itens).toHaveLength(65);
    expect(d.fila.itens.every((i) => i.ficha.length > 3 && i.caso.decisao)).toBe(true);
    const estourados = d.fila.itens.filter((i) => i.slaEstourado).length;
    expect(d.fila.itens.slice(0, estourados).every((i) => i.slaEstourado)).toBe(true);
  });

  it("visão geral: métricas com os nomes da simulação, sem demanda fora do denominador", () => {
    const r = d.visao.resultado;
    expect(r.semPessoa.nova).toBeGreaterThan(r.semPessoa.vigente);
    expect(r.semPessoa.novaTodas).toBeGreaterThan(r.semPessoa.nova); // as sem demanda inflam a medida com todas
    expect(r.sozinho.nova).toBeGreaterThanOrEqual(r.semPessoa.novaTodas); // Reclame Aqui: ação sozinha, resposta aprovada
    expect(d.visao.problema).toHaveLength(4);
  });

  it("analista: três incidentes e no máximo 300 avisos hoje", () => {
    expect(d.analista.incidentes.map((i) => i.tipo)).toEqual(["transportadora_uf", "brinde_campanha", "cobranca_duplicada"]);
    expect(d.analista.avisosHoje).toBeLessThanOrEqual(300);
  });

  it("casos, autonomia e conferência", () => {
    expect(d.casos).toHaveLength(3);
    expect(d.autonomia.cenarios.at(-1)?.nome).toBe("8_padrao_motivo_jev");
    expect(d.autonomia.faixaP.map((r) => r.p_sem_sinal)).toEqual([0.02, 0.05, 0.1]);
    expect(d.conferencia.anexos).toHaveLength(9);
    expect(d.conferencia.jev.revisao.acuraciaMinima).toBeCloseTo(0.758, 2);
  });

  it("nada de texto do cliente nos dados da interface", () => {
    const tudo = JSON.stringify(d);
    expect(tudo).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/); // CPF
    expect(tudo).not.toContain('"autor":"cliente"');
  });
});

describe("linhasDaFicha", () => {
  it("cada linha tem campo, valor e origem", () => {
    const f = montarContexto(montarPainel().fila.itens[0].id)!;
    for (const l of linhasDaFicha(f)) expect(l.origem.length).toBeGreaterThan(0);
  });
});
