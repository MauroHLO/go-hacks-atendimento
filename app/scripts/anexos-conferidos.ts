// Anexos em que o verificador vê "produto da foto diferente do pedido" (docs/decisoes.md, seção 3), para a
// conferência manual e a aba "Como conferimos a IA". Lê data/raw localmente; grava só identificadores, a
// descrição do módulo de visão (não é texto do cliente), o produto do pedido e os outros sinais da foto.
// Uso (em app/): npm run anexos-conferidos

import { writeFileSync } from "node:fs";
import path from "node:path";
import { compararFotoComPedido } from "../src/lib/evidencias";
import type { Item, Pedido } from "../src/lib/dados";
import { anexosPorData, lerCsv, nomesCatalogo, OUT, porPedido, porPedidoItens } from "./dados-brutos";

const sinaisCsv = new Map(lerCsv("../../processed/anexos_sinais").map((l) => [String(l.anexo_id), l]));

const linhas = [];
for (const a of anexosPorData) {
  if (!a.order_id || !a.descricao_visual) continue;
  const pedido = porPedido.get(a.order_id);
  if (!pedido) continue;
  const itens = (porPedidoItens.get(a.order_id) ?? []) as unknown as Item[];
  const cmp = compararFotoComPedido(a.descricao_visual, pedido as unknown as Pedido, itens, nomesCatalogo);
  if (!cmp) continue;
  const s = sinaisCsv.get(a.anexo_id);
  const outros: string[] = [];
  if (s?.hash_outro_pedido === "True" || s?.hash_outro_cliente === "True") outros.push("hash em outro pedido ou cliente");
  if (s?.exif_antes_entrega === "True") outros.push("EXIF antes da entrega");
  if (s?.exif_software_edicao === "True") outros.push("software de edição no EXIF");
  linhas.push({
    anexo_id: a.anexo_id,
    conversation_id: a.conversation_id,
    order_id: a.order_id,
    descricao_visual: a.descricao_visual,
    produto_do_pedido: String(pedido.descricao_produto),
    regra: cmp.motivo,
    numero_regra: cmp.regra,
    forca: cmp.forte ? "forte" : "fraco (rebaixada na conferência manual)",
    outros_sinais_fortes: outros,
  });
}

const saida = {
  gerado_por: "app/scripts/anexos-conferidos.ts",
  n: linhas.length,
  todos_com_outro_sinal_forte: linhas.every((l) => l.outros_sinais_fortes.length > 0),
  regra_4_fraca: linhas.filter((l) => l.numero_regra === 4).map((l) => l.anexo_id),
  anexos: linhas,
};
writeFileSync(path.join(OUT, "anexos_conferidos.json"), JSON.stringify(saida, null, 2) + "\n");
console.log(`${linhas.length} anexos com produto diferente; todos com outro sinal forte: ${saida.todos_com_outro_sinal_forte}`);
