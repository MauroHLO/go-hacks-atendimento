import { describe, expect, it } from "vitest";
import { baseVazia } from "../dados";
import { Simulador } from "../ferramentas";
import { AVISO, detectarIncidentes, type Agregados, type PedidoAfetado } from "./analista";

const AG: Agregados = {
  recontato_transportadora_uf: [
    { transportadora: "Transp A", uf: "BA", conversas: 200, pct_recontato: 70 },
    { transportadora: "Transp A", uf: "PE", conversas: 29, pct_recontato: 90 }, // menos de 30 conversas
    { transportadora: "Transp A", uf: "SP", conversas: 100, pct_recontato: 30 }, // abaixo de 2× 20
    { transportadora: "Transp B", uf: "SC", conversas: 40, pct_recontato: 40 }, // exatamente 2× 20
  ],
  pct_recontato_demais_transportadoras: 20,
  brinde: { conversas: 100, conversas_produto_faltando: 25, pedidos_com_brinde_e_conversa: 80 },
};

function afetado(id: string, p: Partial<PedidoAfetado> = {}): PedidoAfetado {
  return { order_id: id, customer_id: `C${id}`, transportadora: "Transp A", uf: "BA", status_entrega: "em_transito", data_prometida: null, tem_brinde: false, aceita_comunicacao_whatsapp: "sim", aceita_comunicacao_email: "não", ...p };
}

const analista = (agora = "2026-11-02 09:00:00") => new Simulador({ base: baseVazia(), papel: "analista", agora: () => agora });

describe("detecção", () => {
  it("transportadora × UF com recontato >= 2× as demais e >= 30 conversas; brinde >= 25%", () => {
    const r = detectarIncidentes({ sim: analista(), agregados: AG, afetados: [] });
    expect(r.incidentes.map((i) => i.escopo)).toEqual(["Transp A: BA", "Transp B: SC", "Mimo de Outubro GoBeauté: brinde não enviado"]);
    expect(r.incidentes[0].evidencias[0]).toContain("70% de recontato em 200 conversas");
    expect(r.log.filter((l) => l.acao === "abrir_incidente")).toHaveLength(3);
  });

  it("cobrança em dobro sem estorno: incidente com os estornos preparados, sem aviso em massa", () => {
    const ag = { ...AG, cobranca_duplicada: { pedidos: 81, com_estorno: 69, sem_estorno: 12, valor_excedente_sem_estorno_rs: 1668.81, conversas_nesses_pedidos: 99 } };
    const i = detectarIncidentes({ sim: analista(), agregados: ag, afetados: [] }).incidentes.at(-1)!;
    expect(i).toMatchObject({ tipo: "cobranca_duplicada", pedidosAfetados: 12, avisos: [] });
    expect(i.evidencias[1]).toContain("R$ 1668,81");
    expect(i.acao).toContain("12 estornos preparados");
    const zerado = { ...ag, cobranca_duplicada: { ...ag.cobranca_duplicada, sem_estorno: 0 } };
    expect(detectarIncidentes({ sim: analista(), agregados: zerado, afetados: [] }).incidentes.map((x) => x.tipo)).not.toContain("cobranca_duplicada");
  });

  it("abaixo dos limiares: nenhum incidente", () => {
    const ag = { ...AG, recontato_transportadora_uf: [AG.recontato_transportadora_uf[2]], brinde: { ...AG.brinde, conversas_produto_faltando: 24 } };
    expect(detectarIncidentes({ sim: analista(), agregados: ag, afetados: [] }).incidentes).toEqual([]);
  });

  it("só o analista abre incidente e notifica", () => {
    const r = detectarIncidentes({ sim: new Simulador({ base: baseVazia(), papel: "atendente" }), agregados: AG, afetados: [afetado("1")] });
    expect(r.incidentes.every((i) => i.referencia === null)).toBe(true);
    expect(r.log).toHaveLength(0);
  });
});

describe("avisos proativos", () => {
  it("só pedidos afetados com consentimento; texto sem promessa de prazo", () => {
    const afetados = [afetado("1"), afetado("2", { aceita_comunicacao_whatsapp: "não" }), afetado("3", { uf: "SP" })];
    const r = detectarIncidentes({ sim: analista(), agregados: AG, afetados });
    const i = r.incidentes[0];
    expect(i).toMatchObject({ pedidosAfetados: 2, semConsentimento: 1 });
    expect(i.avisos).toEqual([{ dia: "2026-11-02", pedidos: 1, executado: true, referencia: "NOT-SIM-000001" }]);
    expect(AVISO.atraso_transportadora("Transp A")).not.toMatch(/\d/);
    expect(AVISO.brinde_campanha()).not.toMatch(/\bprazo|garant/i);
  });

  it("no máximo 300 por dia somando os incidentes; o resto fica preparado para os dias seguintes", () => {
    const afetados = [
      ...Array.from({ length: 250 }, (_, i) => afetado(`A${i}`)),
      ...Array.from({ length: 200 }, (_, i) => afetado(`B${i}`, { transportadora: "Outra", tem_brinde: true })),
    ];
    const r = detectarIncidentes({ sim: analista(), agregados: AG, afetados });
    const transp = r.incidentes[0].avisos;
    const brinde = r.incidentes.find((i) => i.tipo === "brinde_campanha")!.avisos;
    expect(transp).toEqual([{ dia: "2026-11-02", pedidos: 250, executado: true, referencia: "NOT-SIM-000001" }]);
    expect(brinde).toEqual([
      { dia: "2026-11-02", pedidos: 50, executado: true, referencia: "NOT-SIM-000002" },
      { dia: "2026-11-03", pedidos: 150, executado: false, referencia: null },
    ]);
  });

  it("pedido afetado por dois incidentes recebe um aviso só", () => {
    const r = detectarIncidentes({ sim: analista(), agregados: AG, afetados: [afetado("1", { tem_brinde: true })] });
    const total = r.incidentes.flatMap((i) => i.avisos).reduce((a, v) => a + v.pedidos, 0);
    expect(total).toBe(1);
  });
});
