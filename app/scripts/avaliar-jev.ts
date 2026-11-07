// Avaliação do Jev contra a tag do atendente (docs/decisoes.md, seção 6).
// Uso (em app/): npm run avaliar-jev   (lê data/raw localmente e chama o AI Proxy de verdade)
// - amostra estratificada de 120 conversas com mensagem do cliente (semente 20261107), por tag_agente;
// - as 572 conversas que a simulação deixou em "sem_demanda" (330, sem mensagem do cliente: o Jev não
//   tem o que ler) ou "outro" (242: tag Outros ou Reclamação produto sem saúde nem personalização).
// Grava data/processed/avaliacao_jev.json (concordância, matriz de confusão, confiança, 20 desencontros e o
// motivo reclassificado das 572), sem texto do cliente.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { classificar, type Classificacao } from "../src/lib/agent/classificador";
import { configDoAmbiente, criarClienteProxy } from "../src/lib/agent/cliente";
import { detectarSinais } from "../src/lib/agent/sinais";
import { TAG_DO_MOTIVO } from "../src/lib/agent/taxonomia";
import { aleatorio, conversas, motivoDaTag, OUT, porConversaMsg, porPedido, type Linha } from "./dados-brutos";

const SEMENTE = 20261107;
const TAMANHO_AMOSTRA = 120;
const CONCORRENCIA = 5;

function textosCliente(c: Linha): string[] {
  return (porConversaMsg.get(String(c.conversation_id)) ?? []).filter((m) => m.autor === "cliente").map((m) => String(m.texto ?? ""));
}

function motivoSimulado(c: Linha): string {
  const textos = textosCliente(c);
  const texto = textos.join(" ");
  const pedido = c.order_id ? porPedido.get(String(c.order_id)) : undefined;
  return motivoDaTag(c.tag_agente as string | null, pedido, texto, 0, detectarSinais(texto).saude);
}

// ---------- amostras ----------
const comMensagem = conversas.filter((c) => textosCliente(c).length > 0 && c.tag_agente);
const porTag = new Map<string, Linha[]>();
for (const c of comMensagem) porTag.set(String(c.tag_agente), [...(porTag.get(String(c.tag_agente)) ?? []), c]);
const tags = [...porTag.keys()].sort();
const rnd = aleatorio(SEMENTE);
function embaralhar<T>(v: T[]): T[] {
  const a = [...v];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// Alocação igual por tag (concordância comparável entre tags); o resto vai para as tags maiores.
const base = Math.floor(TAMANHO_AMOSTRA / tags.length);
const resto = TAMANHO_AMOSTRA - base * tags.length;
const maiores = [...tags].sort((a, b) => porTag.get(b)!.length - porTag.get(a)!.length).slice(0, resto);
const amostra: Linha[] = tags.flatMap((t) => embaralhar(porTag.get(t)!).slice(0, base + (maiores.includes(t) ? 1 : 0)));

const alvo572 = conversas.filter((c) => {
  const m = motivoSimulado(c);
  return m === "sem_demanda" || m === "outro";
});

// ---------- Jev ----------
async function emLotes<T, R>(itens: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array(itens.length);
  let proximo = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, itens.length) }, async () => {
      while (proximo < itens.length) {
        const i = proximo++;
        saida[i] = await f(itens[i]);
      }
    }),
  );
  return saida;
}

async function main() {
  const ia = criarClienteProxy(configDoAmbiente());
  const unicos = new Map<string, Linha>();
  for (const c of [...amostra, ...alvo572]) unicos.set(String(c.conversation_id), c);
  const inicio = Date.now();
  const resultados = new Map<string, Classificacao>();
  await emLotes([...unicos.values()], CONCORRENCIA, async (c) => {
    resultados.set(String(c.conversation_id), await classificar(ia, { mensagensCliente: textosCliente(c), assunto: (c.assunto as string) ?? null, canal: String(c.canal) }));
  });
  // Falhas da primeira passada (confiabilidade do proxy) e nova tentativa, uma a uma, ao fim do lote.
  const falhasPrimeira: Record<string, number> = {};
  const falhadas = [...unicos.values()].filter((c) => !resultados.get(String(c.conversation_id))!.valida);
  if (falhadas.length > 0) await new Promise((ok) => setTimeout(ok, 30_000)); // espera a janela de limite do proxy
  for (const c of falhadas) {
    await new Promise((ok) => setTimeout(ok, 2_000));
    const r = resultados.get(String(c.conversation_id))!;
    const k = `${r.falha}${r.falhaStatus ? `_${r.falhaStatus}` : ""}`;
    falhasPrimeira[k] = (falhasPrimeira[k] ?? 0) + 1;
    resultados.set(String(c.conversation_id), await classificar(ia, { mensagensCliente: textosCliente(c), assunto: (c.assunto as string) ?? null, canal: String(c.canal) }));
  }
  const ms = Date.now() - inicio;

  // ---------- comparação na amostra ----------
  const linhas = amostra.map((c) => {
    const r = resultados.get(String(c.conversation_id))!;
    const tag = String(c.tag_agente);
    return {
      conversation_id: String(c.conversation_id),
      tag,
      motivo_tag: motivoSimulado(c),
      motivo_jev: r.motivo,
      tag_do_motivo_jev: TAG_DO_MOTIVO[r.motivo],
      confianca: Math.round(r.confianca * 1000) / 1000,
      valida: r.valida,
      concorda_tag: TAG_DO_MOTIVO[r.motivo] === tag,
      concorda_motivo: r.motivo === motivoSimulado(c),
    };
  });
  const porTagRes = Object.fromEntries(
    tags.map((t) => {
      const l = linhas.filter((x) => x.tag === t);
      return [t, { n: l.length, concordancia_tag: Math.round((l.filter((x) => x.concorda_tag).length / l.length) * 1000) / 1000 }];
    }),
  );
  const matriz: Record<string, Record<string, number>> = {};
  for (const l of linhas) {
    matriz[l.tag] ??= {};
    matriz[l.tag][l.motivo_jev] = (matriz[l.tag][l.motivo_jev] ?? 0) + 1;
  }
  const faixas = [
    ["<0,5", 0, 0.5],
    ["0,5-0,7", 0.5, 0.7],
    ["0,7-0,9", 0.7, 0.9],
    [">=0,9", 0.9, 1.01],
  ] as const;
  const distribuicao = (v: typeof linhas) =>
    Object.fromEntries(faixas.map(([nome, a, b]) => [nome, v.filter((x) => x.confianca >= a && x.confianca < b).length]));
  const desencontros = linhas
    .filter((l) => !l.concorda_tag)
    .sort((a, b) => b.confianca - a.confianca)
    .slice(0, 20)
    .map(({ conversation_id, tag, motivo_jev, confianca }) => ({ conversation_id, tag, motivo_jev, confianca }));

  // ---------- as 572 ----------
  const reclassificadas = alvo572.map((c) => {
    const r = resultados.get(String(c.conversation_id))!;
    return {
      conversation_id: String(c.conversation_id),
      tag: (c.tag_agente as string) ?? null,
      motivo_simulacao: motivoSimulado(c),
      motivo_jev: r.motivo,
      confianca: Math.round(r.confianca * 1000) / 1000,
      valida: r.valida,
      sem_mensagem_do_cliente: r.semMensagemDoCliente,
    };
  });
  const contagem = (v: { motivo_jev: string }[]) => Object.fromEntries(Object.entries(v.reduce<Record<string, number>>((a, x) => ((a[x.motivo_jev] = (a[x.motivo_jev] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]));
  const comMsg572 = reclassificadas.filter((r) => !r.sem_mensagem_do_cliente);

  const custo = [...resultados.values()].reduce((a, r) => a + (r.uso.custoUsd ?? 0), 0);
  const saida = {
    gerado_por: "app/scripts/avaliar-jev.ts",
    semente: SEMENTE,
    modelo: [...resultados.values()].find((r) => r.modeloJev)?.modeloJev ?? null,
    chamadas: [...resultados.values()].filter((r) => !r.semMensagemDoCliente).length,
    falhas_primeira_passada: { total: falhadas.length, por_tipo: falhasPrimeira, de: [...resultados.values()].filter((r) => !r.semMensagemDoCliente).length },
    invalidas_depois_da_nova_tentativa: [...resultados.values()].filter((r) => !r.valida).length,
    ms_total: ms,
    custo_usd: Math.round(custo * 1e6) / 1e6,
    amostra: {
      n: linhas.length,
      alocacao: Object.fromEntries(tags.map((t) => [t, linhas.filter((l) => l.tag === t).length])),
      concordancia_tag: Math.round((linhas.filter((l) => l.concorda_tag).length / linhas.length) * 1000) / 1000,
      concordancia_motivo_mapeado: Math.round((linhas.filter((l) => l.concorda_motivo).length / linhas.length) * 1000) / 1000,
      concordancia_por_tag: porTagRes,
      matriz_confusao_tag_x_jev: matriz,
      confianca_todas: distribuicao(linhas),
      confianca_concordantes: distribuicao(linhas.filter((l) => l.concorda_tag)),
      confianca_discordantes: distribuicao(linhas.filter((l) => !l.concorda_tag)),
      desencontros_para_revisao: desencontros,
    },
    reclassificacao_572: {
      n: reclassificadas.length,
      sem_mensagem_do_cliente: reclassificadas.length - comMsg572.length,
      com_mensagem: comMsg572.length,
      motivo_jev_das_com_mensagem: contagem(comMsg572),
      confianca_das_com_mensagem: distribuicao(comMsg572 as never),
      conversas: reclassificadas,
    },
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, "avaliacao_jev.json"), JSON.stringify(saida, null, 2) + "\n");

  const { conversas: _c, ...r572 } = saida.reclassificacao_572;
  void _c;
  const { desencontros_para_revisao: des, ...am } = saida.amostra;
  console.log(JSON.stringify({ ...saida, amostra: am, reclassificacao_572: r572 }, null, 2));
  console.log("\n20 desencontros (tag × Jev) para revisão manual:");
  console.table(des);
  console.log(`Gravado em ${path.join(OUT, "avaliacao_jev.json")}`);
}

main();
