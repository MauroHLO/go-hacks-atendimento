// Três casos do histórico para a demonstração (a fila de 02/11 não tem anexos) — docs/decisoes.md, seção 6.
// Uso (em app/): npm run casos-demo   (lê data/raw localmente e chama o AI Proxy de verdade)
// Seleção determinística (a primeira conversa, em ordem cronológica, que atende ao critério):
//  1. avaria_sem_sinal: tag Avaria, com foto, sem nenhum sinal, dentro de 7 dias → o padrão resolve no nível 0;
//  2. hash_outro_cliente: foto cuja mesma imagem já apareceu em conversa de outro cliente → nível 2;
//  3. reacao_adversa: tag Reclamação produto com menção de saúde → nível 2.
// Cada caso roda pelo orquestrador real, na data da conversa, com o índice de hash só até aquele momento.
// Grava data/processed/casos_demo.json, sem texto do cliente (só a resposta redigida e checada).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { configDoAmbiente, criarClienteProxy } from "../src/lib/agent/cliente";
import { novoEstado, processarConversa } from "../src/lib/agent/orquestrador";
import { detectarSinais } from "../src/lib/agent/sinais";
import { fatosParaPolitica, montarContexto } from "../src/lib/contexto";
import { instante } from "../src/lib/dados";
import { calcularSinais } from "../src/lib/evidencias";
import { Simulador } from "../src/lib/ferramentas";
import { CENARIO_PADRAO, decidirNivel } from "../src/lib/policy";
import {
  baseDaConversa,
  conversas,
  custoBrinde,
  indiceAte,
  momentoDaDecisao,
  nomesCatalogo,
  OUT,
  porConversaAnexos,
  porConversaMsg,
  type Linha,
} from "./dados-brutos";
import { resumo } from "./resumo";

void custoBrinde;
const ordenadas = [...conversas].sort((a, b) => instante(String(a.data_abertura)) - instante(String(b.data_abertura)));
const texto = (c: Linha) =>
  (porConversaMsg.get(String(c.conversation_id)) ?? []).filter((m) => m.autor === "cliente").map((m) => String(m.texto)).join(" ");

function sinaisNaData(c: Linha) {
  const agora = momentoDaDecisao(c);
  const indice = indiceAte(instante(agora));
  const base = baseDaConversa(c, { indiceHash: indice });
  const ficha = montarContexto(String(c.conversation_id), base, agora)!;
  if (!ficha.pedido.valor) return null;
  const r = calcularSinais({
    anexos: ficha.anexos.valor,
    pedido: ficha.pedido.valor,
    itens: ficha.itens.valor,
    customerId: String(c.customer_id),
    nTrocas12m: ficha.resumo.reenviosCliente12m.valor,
    indiceHash: indice,
    nomesCatalogo,
    dataReclamacao: String(c.data_abertura),
  });
  return { agora, base, ficha, r };
}

const CRITERIOS: { tipo: string; descricao: string; escolhe: (c: Linha) => boolean }[] = [
  {
    tipo: "avaria_sem_sinal",
    descricao: "Avaria com foto, sem nenhum sinal e dentro do prazo: o agente resolve sozinho (nível 0).",
    escolhe: (c) => {
      if (c.tag_agente !== "Avaria" || !porConversaAnexos.has(String(c.conversation_id))) return false;
      const s = sinaisNaData(c);
      if (!s || s.r.sinais.length > 0) return false;
      const fatos = fatosParaPolitica(s.ficha)!;
      return decidirNivel({ motivo: "avaria", confiancaClassificador: 1, fatos, sinais: [], valorAcao: fatos.valorPedido, canal: c.canal as "whatsapp", cenario: CENARIO_PADRAO }).nivel === 0 && c.canal !== "reclame_aqui";
    },
  },
  {
    tipo: "hash_outro_cliente",
    descricao: "Foto que já apareceu em conversa de outro cliente: sinal forte, o supervisor decide (nível 2) e o cliente recebe só \"em análise\".",
    escolhe: (c) => {
      if (!porConversaAnexos.has(String(c.conversation_id)) || c.canal === "reclame_aqui") return false;
      const s = sinaisNaData(c);
      return !!s && s.r.detalhes.some((d) => d.sinal === "hash_em_outro_pedido_ou_cliente" && d.evidencia.includes("outro cliente"));
    },
  },
  {
    tipo: "reacao_adversa",
    descricao: "Reação adversa a cosmético: orientar a suspensão do uso e acionar a qualidade para a cosmetovigilância em 24 h (nível 2).",
    escolhe: (c) => c.tag_agente === "Reclamação produto" && c.canal !== "reclame_aqui" && detectarSinais(texto(c)).saude,
  },
];

async function main() {
  const ia = criarClienteProxy(configDoAmbiente());
  const casos = [];
  for (const crit of CRITERIOS) {
    const c = ordenadas.find(crit.escolhe);
    if (!c) {
      casos.push({ tipo: crit.tipo, erro: "nenhuma conversa atende ao critério" });
      continue;
    }
    const agora = momentoDaDecisao(c);
    const base = baseDaConversa(c, { indiceHash: indiceAte(instante(agora)) });
    const sim = new Simulador({ base, cenario: CENARIO_PADRAO, agora: () => agora });
    const r = await processarConversa(String(c.conversation_id), { sim, ia, estado: novoEstado(), agora });
    casos.push({
      tipo: crit.tipo,
      descricao: crit.descricao,
      momento_da_decisao: agora,
      tag_agente: c.tag_agente ?? null,
      ficha: {
        order_id: r.ficha.pedido.valor?.order_id ?? null,
        status_entrega: r.ficha.resumo.statusEntrega,
        data_entrega: r.ficha.resumo.dataEntrega,
        dias_desde_recebimento: r.ficha.resumo.diasDesdeRecebimento,
        anexos: r.ficha.anexos.valor.length,
        reenvios_cliente_12m: r.ficha.resumo.reenviosCliente12m,
      },
      ...resumo(r, { evidencias: true }),
    });
    console.log(`\n== ${crit.tipo}: ${c.conversation_id} (${c.canal}, tag ${c.tag_agente})`);
    console.log(`   Jev: ${r.classificacao.motivo} (${r.classificacao.confianca.toFixed(2)}); sinais: ${r.sinais?.sinais.join(", ") || "nenhum"}`);
    console.log(`   nível ${r.decisao.nivel} → ${r.decisao.nivelFinal}; ${r.decisao.ferramenta}; ações: ${r.acoes.map((a) => a.ferramenta + (a.ok ? "" : "✗")).join(", ")}`);
    console.log(`   resposta (${r.resposta.enviada ? "enviada" : "para aprovação"}): ${r.resposta.texto}`);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, "casos_demo.json"), JSON.stringify({ gerado_por: "app/scripts/casos-demo.ts", cenario: CENARIO_PADRAO.nome, casos }, null, 2) + "\n");
  console.log(`\nGravado em ${path.join(OUT, "casos_demo.json")}`);
}

main();
