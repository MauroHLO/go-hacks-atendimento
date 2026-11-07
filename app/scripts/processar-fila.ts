// Processa as 65 conversas da fila de 02/11 08:00 pelo agente de ponta a ponta (docs/decisoes.md, seção 6).
// Uso (em app/): npm run processar-fila   (lê ../.env.local; chama o AI Proxy de verdade)
// Grava data/processed/fila_resultado.json: só estrutura e a resposta redigida (já checada); nenhum texto do cliente.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { configDoAmbiente, criarClienteProxy } from "../src/lib/agent/cliente";
import { detectarIncidentes } from "../src/lib/agent/analista";
import { novoEstado, processarConversa } from "../src/lib/agent/orquestrador";
import { resumo } from "./resumo";
import { BASE } from "../src/lib/dados";
import { Simulador } from "../src/lib/ferramentas";
import { CENARIO_PADRAO } from "../src/lib/policy";
import { OUT } from "./caminhos";

const CONCORRENCIA = 5;

async function emLotes<T, R>(itens: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array(itens.length);
  let proximo = 0;
  async function trabalhador() {
    while (proximo < itens.length) {
      const i = proximo++;
      saida[i] = await f(itens[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, trabalhador));
  return saida;
}

async function main() {
  const ia = criarClienteProxy(configDoAmbiente());
  const sim = new Simulador({ cenario: CENARIO_PADRAO });
  const estado = novoEstado();
  const inicio = Date.now();
  const resultados = await emLotes(BASE.conversas, CONCORRENCIA, async (c) => {
    try {
      return resumo(await processarConversa(c.conversation_id, { sim, ia, estado }));
    } catch (e) {
      return { conversation_id: c.conversation_id, erro: e instanceof Error ? e.message.slice(0, 120) : "erro" } as never;
    }
  });
  const msTotal = Date.now() - inicio;

  // Agente analista sobre o histórico agregado.
  const analista = detectarIncidentes({ sim: new Simulador({ papel: "analista", cenario: CENARIO_PADRAO }) });

  // Agregados
  const ok = resultados.filter((r) => !("erro" in r));
  const n = ok.length;
  const pct = (k: number) => Math.round((k / n) * 1000) / 10;
  const niveis = [0, 1, 2].map((k) => ok.filter((r) => r.decisao.nivel_final === k).length);
  const niveisAcao = [0, 1, 2].map((k) => ok.filter((r) => r.decisao.nivel === k).length);
  const porFerramenta: Record<string, number> = {};
  for (const r of ok) for (const l of r.log) porFerramenta[l.acao] = (porFerramenta[l.acao] ?? 0) + 1;
  const sistemas = ok.map((r) => r.telemetria.sistemasAcessados);
  const tempos = ok.map((r) => r.telemetria.ms);
  const custo = ok.reduce((a, r) => a + r.telemetria.custoUsdEstimado, 0);
  const tok = ok.reduce(
    (a, r) => ({
      jevEntrada: a.jevEntrada + r.telemetria.jev.tokensEntrada,
      jevSaida: a.jevSaida + r.telemetria.jev.tokensSaida,
      chatEntrada: a.chatEntrada + r.telemetria.chat.tokensEntrada,
      chatSaida: a.chatSaida + r.telemetria.chat.tokensSaida,
    }),
    { jevEntrada: 0, jevSaida: 0, chatEntrada: 0, chatSaida: 0 },
  );
  const motivos: Record<string, number> = {};
  for (const r of ok) motivos[r.classificacao.motivo] = (motivos[r.classificacao.motivo] ?? 0) + 1;
  const sumario = {
    conversas: BASE.conversas.length,
    processadas: n,
    erros: resultados.length - n,
    pct_nivel_final: { 0: pct(niveis[0]), 1: pct(niveis[1]), 2: pct(niveis[2]) },
    pct_nivel_acao: { 0: pct(niveisAcao[0]), 1: pct(niveisAcao[1]), 2: pct(niveisAcao[2]) },
    respostas_enviadas: ok.filter((r) => r.resposta.enviada).length,
    respostas_para_aprovacao: ok.filter((r) => r.resposta.paraAprovacao).length,
    texto_de_reserva: ok.filter((r) => r.resposta.reserva).length,
    redacao_aprovada_na_2a_tentativa: ok.filter((r) => r.resposta.tentativas === 2 && !r.resposta.reserva).length,
    classificacao_invalida: ok.filter((r) => !r.classificacao.valida).length,
    confianca_abaixo_de_0_7: ok.filter((r) => r.classificacao.valida && r.classificacao.confianca < 0.7).length,
    motivos,
    acoes_por_ferramenta: Object.fromEntries(Object.entries(porFerramenta).sort((a, b) => b[1] - a[1])),
    sistemas_acessados_por_conversa: Math.round((sistemas.reduce((a, b) => a + b, 0) / n) * 100) / 100,
    tempo_medio_ms: Math.round(tempos.reduce((a, b) => a + b, 0) / n),
    tempo_total_lote_ms: msTotal,
    concorrencia: CONCORRENCIA,
    tokens: tok,
    custo_ia_usd: Math.round(custo * 1e6) / 1e6,
    custo_observacao: "custo informado pelo proxy só no Jev; o chat não informa custo (tokens acima)",
    modelo_redacao: ia.modelo,
  };

  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    path.join(OUT, "fila_resultado.json"),
    JSON.stringify({ gerado_por: "app/scripts/processar-fila.ts", cenario: CENARIO_PADRAO.nome, sumario, analista, conversas: resultados }, null, 2) + "\n",
  );

  console.log(JSON.stringify(sumario, null, 2));
  console.log("\nIncidentes:", analista.incidentes.map((i) => `${i.referencia} ${i.escopo} (avisos: ${i.avisos.map((a) => `${a.dia} ${a.pedidos}${a.executado ? " enviados" : " preparados"}`).join("; ")})`));
  console.log(`\nGravado em ${path.join(OUT, "fila_resultado.json")}`);
}

main();
