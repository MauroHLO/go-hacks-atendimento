"use client";

// Autonomia: nível da ação por cenário da simulação (barras empilhadas 100%), ganho de cada regra somada,
// faixa de p, freio e auditoria, e a recomendação de política nº 1 (reenvio por atraso).
// Cor dos níveis = marca; identidade nunca só pela cor: legenda, rótulo direto e tabela ao lado.

import { useState } from "react";
import type { DadosPainel } from "@/lib/painel/dados";
import { Cabecalho, Cartao, Detalhes, Fonte, FUNDO_NIVEL, NivelChip, pct, Subtitulo, Tabela, TD, TH, type Nivel } from "./ui";

const TEXTO_SEGMENTO: Record<Nivel, string> = { 0: "text-white", 1: "text-tinta", 2: "text-white" };
const r$ = (v: number) => `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
const sinal = (v: number, f: (x: number) => string) => (v > 0 ? `+${f(v)}` : v < 0 ? `−${f(-v)}` : f(0));

export function Autonomia({ a }: { a: DadosPainel["autonomia"] }) {
  const [dica, setDica] = useState<string | null>(null);
  const p = a.padrao;
  const pctAtraso = Math.round((p.reenvios_atraso_original_entregue_depois / p.reenvios_atraso_nivel0) * 100);

  return (
    <div className="space-y-8">
      <Cabecalho etiqueta="Autonomia" titulo="O que cada regra libera" frase="Cada mudança de política foi medida nas 2.984 conversas do histórico e só entrou se o saldo seguiu positivo." />

      <section className="rounded-3xl border-4 border-limao p-5">
        <span className="inline-block rounded-full bg-limao px-3 py-0.5 text-sm font-semibold text-azul-escuro">Recomendação de política nº 1</span>
        <p className="mt-2 text-xl font-extrabold text-azul sm:text-2xl">
          Em {pctAtraso}% dos reenvios por atraso o pedido original chegou depois: cerca de R$ {(p.perda_reenvio_atraso_politica_mes_rs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil por mês.
        </p>
        <p className="mt-2 text-tinta">É custo da política, não da autonomia. Proposta: reenviar sozinho só com extravio confirmado pela transportadora.</p>
        <details className="mt-2 text-sm text-tinta"><summary className="cursor-pointer font-semibold text-azul">Ver o cálculo</summary><p className="mt-1">
          {p.reenvios_atraso_original_entregue_depois} de {p.reenvios_atraso_nivel0} reenvios por atraso acima de 7 dias úteis (amostra) tiveram o original entregue depois; custo de {r$(p.perda_reenvio_atraso_politica_mes_rs)}/mês (0,45 × valor do pedido). É custo da política, não da autonomia: quem aprova no nível 1 também não sabe se o original vai chegar. Proposta, a medir antes de mudar: reenviar sozinho só com extravio confirmado pela transportadora; no atraso sem extravio, abrir o chamado e esperar a resposta.
        </p></details>
      </section>

      <section className="space-y-3">
        <Subtitulo>Nível da ação por cenário (p = 0,05)</Subtitulo>
        <ul className="flex flex-wrap gap-4 text-sm" aria-label="Legenda">
          {([0, 1, 2] as Nivel[]).map((n) => (
            <li key={n}>
              <NivelChip nivel={n} />
            </li>
          ))}
        </ul>
        <div className="space-y-2" onMouseLeave={() => setDica(null)}>
          {a.cenarios.map((c) => (
            <div key={c.nome} className="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,18rem)_1fr]">
              <p className={`text-sm ${c.nome === "7_freio_3000" ? "font-semibold text-azul" : "text-tinta"}`}>{c.rotulo}</p>
              <div className="flex h-8 w-full gap-[2px]" role="img" aria-label={`${c.rotulo}: nível 0 ${pct(c.n0)}, nível 1 ${pct(c.n1)}, nível 2 ${pct(c.n2)}`}>
                {([
                  [0, c.n0],
                  [1, c.n1],
                  [2, c.n2],
                ] as [Nivel, number][]).map(([n, v]) =>
                  v > 0 ? (
                    <div
                      key={n}
                      className={`flex h-full items-center justify-center overflow-hidden text-xs font-semibold first:rounded-l last:rounded-r ${FUNDO_NIVEL[n]} ${TEXTO_SEGMENTO[n]}`}
                      style={{ width: `${v}%`, minWidth: 4 }}
                      onMouseEnter={() => setDica(`${c.rotulo} · Nível ${n}: ${pct(v)} das ações · sem nenhuma pessoa ${pct(c.semPessoa)}`)}
                    >
                      {v >= 6 ? pct(v, 0) : ""}
                    </div>
                  ) : null,
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="min-h-5 text-sm text-tinta" aria-live="polite">
          {dica ?? "Passe o mouse numa barra para ver o detalhe."}
        </p>
      </section>

      <Detalhes rotulo="Ver tabelas, ganho de cada regra, faixa de p, freio e auditoria">
        <Tabela legenda="Cenários da simulação">
          <thead>
            <tr>
              <th className={TH}>Cenário</th>
              <th className={TH}>Nível 0</th>
              <th className={TH}>Nível 1</th>
              <th className={TH}>Nível 2</th>
              <th className={TH}>Conversas sem nenhuma pessoa</th>
              <th className={TH}>Horas/mês</th>
              <th className={TH}>Saldo líquido/mês</th>
            </tr>
          </thead>
          <tbody>
            {a.cenarios.map((c) => (
              <tr key={c.nome} className={c.nome === "7_freio_3000" ? "bg-creme font-semibold" : ""}>
                <td className={TD}>{c.rotulo}</td>
                <td className={`${TD} tabular-nums`}>{pct(c.n0)}</td>
                <td className={`${TD} tabular-nums`}>{pct(c.n1)}</td>
                <td className={`${TD} tabular-nums`}>{pct(c.n2)}</td>
                <td className={`${TD} tabular-nums`}>{pct(c.semPessoa)} <span className="font-normal text-tinta-suave">({pct(c.semPessoaTodas)} com as sem demanda)</span></td>
                <td className={`${TD} tabular-nums`}>{c.horas.toLocaleString("pt-BR")}</td>
                <td className={`${TD} tabular-nums`}>{r$(c.saldo)}</td>
              </tr>
            ))}
          </tbody>
        </Tabela>
        <p className="text-sm text-tinta-suave">
          O cenário 6 sobe o nível 0 da ação em 8 pontos sem mexer nas conversas sem nenhuma pessoa: a ação do Reclame Aqui sai sozinha, mas a resposta pública continua com uma pessoa. O cenário 8 é a mesma política do padrão com o motivo dado pelo Jev às conversas que a tag deixou como &quot;Outros&quot;.
        </p>


      <div className="space-y-3">
        <Subtitulo>Ganho de cada regra somada (p = 0,05)</Subtitulo>
        <Tabela legenda="Ganho incremental de cada regra">
          <thead>
            <tr>
              <th className={TH}>Regra somada</th>
              <th className={TH}>Ações no nível 0 (amostra)</th>
              <th className={TH}>Sem nenhuma pessoa (pontos)</th>
              <th className={TH}>Conversas/mês</th>
              <th className={TH}>Horas/mês</th>
              <th className={TH}>Saldo líquido/mês</th>
              <th className={TH}>Saldo comparável/mês</th>
            </tr>
          </thead>
          <tbody>
            {a.ganho.map((g) => (
              <tr key={g.cenario}>
                <td className={TD}>{a.rotulos[g.cenario] ?? g.cenario}</td>
                <td className={`${TD} tabular-nums`}>{sinal(g.delta_acao_nivel0, (x) => String(x))}</td>
                <td className={`${TD} tabular-nums`}>{sinal(g.delta_pct_autonomas_com_demanda, (x) => x.toLocaleString("pt-BR"))}</td>
                <td className={`${TD} tabular-nums`}>{sinal(g.delta_conversas_mes, (x) => String(x))}</td>
                <td className={`${TD} tabular-nums`}>{sinal(g.delta_horas_mes, (x) => x.toLocaleString("pt-BR"))}</td>
                <td className={`${TD} tabular-nums`}>{sinal(g.delta_saldo_mes_rs, r$)}</td>
                <td className={`${TD} tabular-nums`}>{sinal(g.delta_saldo_comparavel_mes_rs, r$)}</td>
              </tr>
            ))}
          </tbody>
        </Tabela>
        <p className="text-sm text-tinta-suave">
          Saldo líquido: custo de atendimento evitado − perda esperada − atrito de sinalizar − auditoria. Saldo comparável: igual, mas desconta o reenvio por atraso em qualquer nível, para não cobrar da autonomia um custo que é da política.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Cartao>
          <Subtitulo>Faixa de p (padrão)</Subtitulo>
          <ul className="mt-2 space-y-1 text-sm text-tinta">
            {a.faixaP.map((r) => (
              <li key={r.p_sem_sinal}>
                p = {r.p_sem_sinal.toLocaleString("pt-BR")}: nível 0 {pct(r.pct_nivel0)}, sem pessoa {pct(r.pct_autonomas_com_demanda)}, saldo {r$(r.saldo_liquido_mes_rs)}/mês
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-tinta-suave">p é hipótese (não há rótulo de fraude): por isso três valores. Saldo positivo em todos.</p>
        </Cartao>
        <Cartao>
          <Subtitulo>Freio de R$ 3.000 por dia</Subtitulo>
          <p className="mt-2 text-sm text-tinta">
            Só nas ações sem teto (direito comprovado). Gasto sem teto: {r$(p.gasto_sem_teto_mes_rs)}/mês; por dia, p90 {r$(p.gasto_sem_teto_dia_p90_rs)} e máximo {r$(p.gasto_sem_teto_dia_max_rs)}. Atuou em {p.dias_com_freio} dias ({p.casos_freados} casos da amostra): limita o pior dia sem mexer no dia típico.
          </p>
        </Cartao>
        <Cartao>
          <Subtitulo>Auditoria por amostra</Subtitulo>
          <p className="mt-2 text-sm text-tinta">
            10% das ações do nível 0 são sorteadas para revisão depois de executadas: {p.auditados} na amostra, {r$(p.auditoria_mes_rs)}/mês (R$ 6 por caso). A pessoa vira supervisora: confere depois, não segura a fila antes.
          </p>
        </Cartao>
      </div>
        <Fonte>{a.fonte}</Fonte>
      </Detalhes>
    </div>
  );
}
