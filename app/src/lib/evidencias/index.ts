// Verificador de evidências (docs/decisoes.md, seção 3).
// Calcula, a partir dos anexos e dos fatos do pedido, os sinais que o motor de política recebe.
// Cada sinal vem com a evidência verificável em texto curto, para o supervisor conferir.
// Nada aqui acusa o cliente: os textos descrevem fatos dos dados (metadados, pedido, histórico).

import { dia, instante, type Anexo, type Item, type OcorrenciaHash, type Pedido } from "../dados";
import { PRAZO_RECLAMACAO_DIAS, type SinalEvidencia } from "../policy";

export type TipoSinal = "forte" | "fraco" | "elegibilidade";

export interface SinalComEvidencia {
  sinal: SinalEvidencia;
  tipo: TipoSinal;
  evidencia: string;
  anexoId?: string;
}

export interface EntradaEvidencias {
  anexos: readonly Anexo[]; // fotos desta reclamação
  pedido: Pedido | null;
  itens: readonly Item[];
  customerId: string;
  nTrocas12m: number | null; // CRM (clientes.n_trocas_12m)
  indiceHash: Readonly<Record<string, readonly OcorrenciaHash[]>>; // sobre todos os anexos conhecidos
  nomesCatalogo: readonly string[]; // produtos.nome
  dataReclamacao: string; // abertura da conversa
}

export interface ResultadoEvidencias {
  sinais: SinalEvidencia[]; // sem repetição, na ordem em que apareceram
  detalhes: SinalComEvidencia[];
}

const DIA_MS = 86_400_000;
// cliente_2_ou_mais_reenvios_12m (sinal fraco definido pelo time)
export const MIN_REENVIOS_SINAL = 2;

// ---------------------------------------------------------------------------
// Produto da foto x pedido
// ---------------------------------------------------------------------------
// Categorias reconhecíveis na descrição visual e na descrição do item.
const CATEGORIAS: readonly [string, RegExp][] = [
  ["capinha", /\b(capinha|case)\b/],
  ["copo", /\bcopo\b/],
  ["garrafa", /\bgarrafa\b/],
  ["necessaire", /\bnecessaire\b/],
  ["bolsa", /\b(tote|bolsa|mochila)\b/],
  ["connect card", /\bconnect card\b/],
  ["mala", /\bmala\b/],
];

function minusculo(t: string): string {
  return t.toLowerCase();
}

function categorias(texto: string): string[] {
  const t = minusculo(texto);
  return CATEGORIAS.filter(([, re]) => re.test(t)).map(([nome]) => nome);
}

function mesmoProduto(a: string, b: string): boolean {
  const x = minusculo(a);
  const y = minusculo(b);
  return x === y || x.includes(y) || y.includes(x);
}

// Incompatibilidade entre a foto e o pedido. Regras 1 a 3 são sinal forte; a regra 4 (estampa × pedido
// personalizado por nome ou iniciais) é sinal fraco desde a conferência manual dos 9 anexos (docs/decisoes.md,
// seção 9): um produto com iniciais pode ter estampa de fundo, e com dados reais isso mandaria clientes honestos
// ao supervisor.
export interface FotoIncompativel {
  regra: 1 | 2 | 3 | 4;
  forte: boolean;
  motivo: string;
}

// Devolve a incompatibilidade, ou null se a foto é compatível (ou não mostra produto).
export function compararFotoComPedido(
  descricao: string,
  pedido: Pick<Pedido, "order_id">,
  itens: readonly Pick<Item, "descricao" | "personalizacao">[],
  nomesCatalogo: readonly string[],
): FotoIncompativel | null {
  // 1. Etiqueta com o número de outro pedido.
  const etiqueta = /n[úu]mero do pedido (G[BC]H\d+)/.exec(descricao);
  if (etiqueta && etiqueta[1] !== pedido.order_id) {
    return { regra: 1, forte: true, motivo: `etiqueta da foto mostra o pedido ${etiqueta[1]}, a conversa é do pedido ${pedido.order_id}` };
  }

  // 2. Produto do catálogo citado pelo nome.
  const nomes = [...new Set([...nomesCatalogo, ...itens.map((i) => i.descricao)])]
    .filter((n) => n.length >= 6 && descricao.includes(n))
    .sort((a, b) => b.length - a.length);
  const citados = nomes.filter((n, i) => !nomes.slice(0, i).some((maior) => maior.includes(n)));
  if (citados.length > 0) {
    const doPedido = citados.some((c) => itens.some((i) => mesmoProduto(c, i.descricao)));
    if (doPedido) return null;
    return { regra: 2, forte: true, motivo: `foto mostra "${citados[0]}", que não está no pedido (${itens.map((i) => i.descricao).join("; ")})` };
  }

  // 3. Categoria genérica (capinha, copo, garrafa...) que não existe no pedido.
  const catFoto = categorias(descricao);
  if (catFoto.length === 0) return null; // caixa, embalagem sem produto identificável
  const itensMesmaCat = itens.filter((i) => categorias(i.descricao).some((c) => catFoto.includes(c)));
  if (itensMesmaCat.length === 0) {
    return { regra: 3, forte: true, motivo: `foto mostra ${catFoto.join("/")}, o pedido tem ${itens.map((i) => i.descricao).join("; ")}` };
  }

  // 4. Mesma categoria, mas a foto mostra estampa de linha e o pedido é personalizado por nome ou iniciais.
  const estampa = /\bestampad[oa]s?\b|\bcom estampa\b/.test(minusculo(descricao));
  const personalizadoTexto = itensMesmaCat.every((i) => i.personalizacao === "nome" || i.personalizacao === "iniciais");
  if (estampa && personalizadoTexto) {
    const tipos = [...new Set(itensMesmaCat.map((i) => i.personalizacao))].join("/");
    return { regra: 4, forte: false, motivo: `foto mostra ${catFoto.join("/")} com estampa, o pedido é personalizado por ${tipos}` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sinais
// ---------------------------------------------------------------------------
function curto(hash: string): string {
  return `${hash.slice(0, 8)}…`;
}

export function calcularSinais(e: EntradaEvidencias): ResultadoEvidencias {
  const detalhes: SinalComEvidencia[] = [];
  const pedido = e.pedido;

  // Elegibilidade
  if (e.anexos.length === 0) {
    detalhes.push({ sinal: "sem_foto", tipo: "elegibilidade", evidencia: "Nenhuma foto recebida nesta conversa." });
  }
  if (pedido?.data_entrega) {
    const dias = Math.round((instante(dia(e.dataReclamacao)) - instante(pedido.data_entrega)) / DIA_MS);
    if (dias > PRAZO_RECLAMACAO_DIAS) {
      detalhes.push({
        sinal: "fora_do_prazo_7_dias",
        tipo: "elegibilidade",
        evidencia: `Reclamação em ${dia(e.dataReclamacao)}, ${dias} dias após a entrega (${pedido.data_entrega}); prazo de ${PRAZO_RECLAMACAO_DIAS} dias.`,
      });
    }
  }

  // Por anexo
  for (const a of e.anexos) {
    // Forte: mesma imagem em outro pedido ou de outro cliente.
    const outros = (e.indiceHash[a.hash_perceptual] ?? []).filter(
      (o) => o.anexo_id !== a.anexo_id && ((o.order_id !== null && o.order_id !== pedido?.order_id) || o.customer_id !== e.customerId),
    );
    if (outros.length > 0) {
      const outroCliente = outros.some((o) => o.customer_id !== e.customerId);
      const pedidos = [...new Set(outros.map((o) => o.order_id).filter(Boolean))];
      detalhes.push({
        sinal: "hash_em_outro_pedido_ou_cliente",
        tipo: "forte",
        anexoId: a.anexo_id,
        evidencia: `Foto ${a.anexo_id}: a mesma imagem (hash ${curto(a.hash_perceptual)}) aparece ${
          outroCliente ? "em conversa de outro cliente" : "em outro pedido do mesmo cliente"
        }${pedidos.length ? ` (pedido ${pedidos.join(", ")})` : ""}.`,
      });
    }

    // Forte: EXIF anterior à entrega.
    if (a.exif_data_captura && pedido?.data_entrega && instante(a.exif_data_captura) < instante(pedido.data_entrega)) {
      detalhes.push({
        sinal: "exif_antes_da_entrega",
        tipo: "forte",
        anexoId: a.anexo_id,
        evidencia: `Foto ${a.anexo_id}: EXIF registra captura em ${a.exif_data_captura}, antes da entrega em ${pedido.data_entrega}.`,
      });
    }

    // Forte: produto da foto diferente do pedido (regras 1 a 3). Fraco: estampa × personalização (regra 4).
    if (pedido) {
      const r = compararFotoComPedido(a.descricao_visual, pedido, e.itens, e.nomesCatalogo);
      if (r?.forte) {
        detalhes.push({ sinal: "produto_da_foto_diferente_do_pedido", tipo: "forte", anexoId: a.anexo_id, evidencia: `Foto ${a.anexo_id}: ${r.motivo}.` });
      } else if (r) {
        detalhes.push({ sinal: "estampa_em_pedido_personalizado", tipo: "fraco", anexoId: a.anexo_id, evidencia: `Foto ${a.anexo_id}: ${r.motivo}.` });
      }
    }

    // Fraco: software de edição no EXIF.
    if (a.exif_software) {
      detalhes.push({
        sinal: "software_de_edicao",
        tipo: "fraco",
        anexoId: a.anexo_id,
        evidencia: `Foto ${a.anexo_id}: EXIF indica o software "${a.exif_software}".`,
      });
    }
  }

  // Fraco: histórico de reenvios do cliente.
  if (e.nTrocas12m !== null && e.nTrocas12m >= MIN_REENVIOS_SINAL) {
    detalhes.push({
      sinal: "cliente_2_ou_mais_reenvios_12m",
      tipo: "fraco",
      evidencia: `CRM: ${e.nTrocas12m} trocas, reenvios ou reimpressões nos últimos 12 meses.`,
    });
  }

  return { sinais: [...new Set(detalhes.map((d) => d.sinal))], detalhes };
}
