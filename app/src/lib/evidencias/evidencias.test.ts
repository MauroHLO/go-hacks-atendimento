import { describe, expect, it } from "vitest";
import type { Anexo, Item, Pedido } from "../dados";
import { calcularSinais, compararFotoComPedido, type EntradaEvidencias } from "./index";

// ---------- casos fictícios ----------

const PEDIDO = {
  order_id: "GCH900001",
  customer_id: "CH900001",
  data_entrega: "2026-10-28",
  valor: 99.9,
} as Pedido;

const ITENS: Item[] = [
  { item_id: "GCH900001-1", order_id: "GCH900001", sku: "GOC-TESTE-1", descricao: "Copo Teste 600ml Personalizado Nome", tipo_item: "venda", quantidade: 1, valor_total: 99.9, personalizacao: "nome", texto_personalizacao: "Fulana", lote: null },
];
const CATALOGO = ["Copo Teste 600ml Personalizado Nome", "Garrafa Teste 500ml Personalizada Iniciais", "Sérum Teste 30ml"];

function anexo(parcial: Partial<Anexo> = {}): Anexo {
  return {
    anexo_id: "IMG-T1",
    conversation_id: "AT900001",
    message_id: "MS-T1",
    order_id: "GCH900001",
    customer_id: "CH900001",
    canal: "whatsapp",
    enviado_em: "2026-10-30 10:00:00",
    tipo: "foto_produto",
    hash_perceptual: "aaaa000000000001",
    exif_data_captura: null,
    exif_modelo_camera: null,
    exif_software: null,
    descricao_visual: "Copo Teste 600ml Personalizado Nome com a pintura descascada.",
    ...parcial,
  };
}

function entrada(parcial: Partial<EntradaEvidencias> = {}): EntradaEvidencias {
  return {
    anexos: [anexo()],
    pedido: PEDIDO,
    itens: ITENS,
    customerId: "CH900001",
    nTrocas12m: 0,
    indiceHash: { aaaa000000000001: [{ anexo_id: "IMG-T1", order_id: "GCH900001", customer_id: "CH900001" }] },
    nomesCatalogo: CATALOGO,
    dataReclamacao: "2026-10-30 09:55:00",
    ...parcial,
  };
}

// ---------- testes ----------

describe("sem sinais", () => {
  it("foto coerente, dentro do prazo, sem EXIF e sem histórico: nenhum sinal", () => {
    expect(calcularSinais(entrada())).toEqual({ sinais: [], detalhes: [] });
  });
});

describe("elegibilidade", () => {
  it("sem foto", () => {
    const r = calcularSinais(entrada({ anexos: [] }));
    expect(r.sinais).toEqual(["sem_foto"]);
    expect(r.detalhes[0]).toMatchObject({ tipo: "elegibilidade" });
  });

  it("7 dias após a entrega: dentro; 8 dias: fora do prazo", () => {
    expect(calcularSinais(entrada({ dataReclamacao: "2026-11-04 23:00:00" })).sinais).toEqual([]);
    const r = calcularSinais(entrada({ dataReclamacao: "2026-11-05 08:00:00" }));
    expect(r.sinais).toEqual(["fora_do_prazo_7_dias"]);
    expect(r.detalhes[0].evidencia).toContain("8 dias após a entrega (2026-10-28)");
  });
});

describe("hash perceptual", () => {
  it("mesma imagem em outro cliente: forte, com o pedido citado", () => {
    const r = calcularSinais(
      entrada({
        indiceHash: {
          aaaa000000000001: [
            { anexo_id: "IMG-T1", order_id: "GCH900001", customer_id: "CH900001" },
            { anexo_id: "IMG-T9", order_id: "GBH900009", customer_id: "CH900009" },
          ],
        },
      }),
    );
    expect(r.sinais).toEqual(["hash_em_outro_pedido_ou_cliente"]);
    expect(r.detalhes[0]).toMatchObject({ tipo: "forte", anexoId: "IMG-T1" });
    expect(r.detalhes[0].evidencia).toContain("outro cliente");
    expect(r.detalhes[0].evidencia).toContain("GBH900009");
  });

  it("mesma imagem em outro pedido do mesmo cliente: forte", () => {
    const r = calcularSinais(
      entrada({
        indiceHash: {
          aaaa000000000001: [
            { anexo_id: "IMG-T1", order_id: "GCH900001", customer_id: "CH900001" },
            { anexo_id: "IMG-T2", order_id: "GCH900002", customer_id: "CH900001" },
          ],
        },
      }),
    );
    expect(r.detalhes[0].evidencia).toContain("outro pedido do mesmo cliente");
  });

  it("mesma imagem reenviada no mesmo pedido: não é sinal", () => {
    const r = calcularSinais(
      entrada({
        indiceHash: {
          aaaa000000000001: [
            { anexo_id: "IMG-T1", order_id: "GCH900001", customer_id: "CH900001" },
            { anexo_id: "IMG-T3", order_id: "GCH900001", customer_id: "CH900001" },
          ],
        },
      }),
    );
    expect(r.sinais).toEqual([]);
  });

  it("hash fora do índice (foto nova do evento): não é sinal", () => {
    expect(calcularSinais(entrada({ indiceHash: {} })).sinais).toEqual([]);
  });
});

describe("EXIF", () => {
  it("captura antes da entrega: forte", () => {
    const r = calcularSinais(entrada({ anexos: [anexo({ exif_data_captura: "2026-10-27 18:00:00" })] }));
    expect(r.sinais).toEqual(["exif_antes_da_entrega"]);
    expect(r.detalhes[0].evidencia).toContain("2026-10-27 18:00:00");
  });

  it("captura no dia da entrega: não é sinal", () => {
    expect(calcularSinais(entrada({ anexos: [anexo({ exif_data_captura: "2026-10-28 09:00:00" })] })).sinais).toEqual([]);
  });

  it("software de edição: fraco", () => {
    const r = calcularSinais(entrada({ anexos: [anexo({ exif_software: "Editor Fictício" })] }));
    expect(r.sinais).toEqual(["software_de_edicao"]);
    expect(r.detalhes[0]).toMatchObject({ tipo: "fraco" });
    expect(r.detalhes[0].evidencia).toContain("Editor Fictício");
  });
});

describe("histórico do cliente", () => {
  it("2 ou mais trocas/reenvios em 12 meses: fraco; 1: não", () => {
    expect(calcularSinais(entrada({ nTrocas12m: 2 })).sinais).toEqual(["cliente_2_ou_mais_reenvios_12m"]);
    expect(calcularSinais(entrada({ nTrocas12m: 1 })).sinais).toEqual([]);
    expect(calcularSinais(entrada({ nTrocas12m: null })).sinais).toEqual([]);
  });
});

describe("produto da foto x pedido", () => {
  const cmp = (d: string, itens: Pick<Item, "descricao" | "personalizacao">[] = ITENS) => compararFotoComPedido(d, PEDIDO, itens, CATALOGO);

  it("produto do pedido citado pelo nome: compatível", () => {
    expect(cmp("Copo Teste 600ml Personalizado Nome com a pintura descascada.")).toBeNull();
  });

  it("outro produto do catálogo citado pelo nome: incompatível", () => {
    expect(cmp("Embalagem de Sérum Teste 30ml amassada e vazando.")).toContain('"Sérum Teste 30ml"');
  });

  it("etiqueta com número de outro pedido: incompatível", () => {
    expect(cmp("Caixa da transportadora com a fita violada; etiqueta com o número do pedido GBH900777 legível.")).toContain("GBH900777");
    expect(cmp("Caixa da transportadora com a fita violada; etiqueta com o número do pedido GCH900001 legível.")).toBeNull();
  });

  it("categoria genérica que não está no pedido: incompatível", () => {
    expect(cmp("Necessaire estampada rasgado na costura.")).toContain("necessaire");
    expect(cmp("Capinha de celular transparente com estampa rachada na lateral.")).toContain("capinha");
  });

  it("mesma categoria, sem estampa: compatível", () => {
    expect(cmp("Copo térmico de inox com a tampa quebrada.")).toBeNull();
  });

  it("mesma categoria com estampa e pedido personalizado por nome: incompatível", () => {
    expect(cmp("Copo térmico estampado com a tampa quebrada.")).toContain("personalizado por nome");
  });

  it("estampa com pedido personalizado por foto: compatível (a foto impressa parece estampa)", () => {
    const itens = [{ descricao: "Case Teste / iPhone Personalizada Foto", personalizacao: "foto" }];
    expect(cmp("Capinha de celular transparente com estampa rachada na lateral.", itens)).toBeNull();
  });

  it("caixa vazia ou embalagem sem produto identificável: compatível", () => {
    expect(cmp("Caixa vazia com papel de enchimento; nota fiscal do pedido ao lado.")).toBeNull();
  });

  it("no cálculo de sinais vira sinal forte com a evidência", () => {
    const r = calcularSinais(entrada({ anexos: [anexo({ descricao_visual: "Embalagem de Sérum Teste 30ml amassada e vazando." })] }));
    expect(r.sinais).toEqual(["produto_da_foto_diferente_do_pedido"]);
    expect(r.detalhes[0]).toMatchObject({ tipo: "forte", anexoId: "IMG-T1" });
  });
});

describe("vários sinais", () => {
  it("sinais sem repetição e uma evidência por anexo", () => {
    const r = calcularSinais(
      entrada({
        anexos: [anexo({ exif_software: "Editor A" }), anexo({ anexo_id: "IMG-T2", hash_perceptual: "bbbb", exif_software: "Editor B" })],
        nTrocas12m: 3,
      }),
    );
    expect(r.sinais).toEqual(["software_de_edicao", "cliente_2_ou_mais_reenvios_12m"]);
    expect(r.detalhes.filter((d) => d.sinal === "software_de_edicao").map((d) => d.anexoId)).toEqual(["IMG-T1", "IMG-T2"]);
  });

  it("nenhum texto de evidência acusa o cliente", () => {
    const r = calcularSinais(
      entrada({
        anexos: [anexo({ exif_data_captura: "2026-10-01 10:00:00", exif_software: "Editor", descricao_visual: "Necessaire estampada rasgada." })],
        nTrocas12m: 4,
        dataReclamacao: "2026-11-20 10:00:00",
        indiceHash: { aaaa000000000001: [{ anexo_id: "IMG-X", order_id: "GBH1", customer_id: "CH2" }] },
      }),
    );
    expect(r.detalhes.length).toBeGreaterThanOrEqual(5);
    for (const d of r.detalhes) expect(d.evidencia.toLowerCase()).not.toMatch(/fraud|golpe|mentir|falsific/);
  });
});
