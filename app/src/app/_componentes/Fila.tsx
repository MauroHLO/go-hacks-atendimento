"use client";

// Fila de agora (02/11 08:00): as 65 conversas em ordem de prioridade (SLA). "Processar a fila" anima o
// resultado já gravado pelo lote real (npm run processar-fila); não chama o modelo de novo.

import { useEffect, useRef, useState } from "react";
import type { DadosPainel, ItemFila } from "@/lib/painel/dados";
import { FichaCaso } from "./FichaCaso";
import { BarraNiveis, Cabecalho, CANAL, Cartao, Detalhes, Fonte, MOTIVO, NivelChip, nomeFerramenta, pct, Tabela, TD, TH, type Nivel } from "./ui";

const PASSO_MS = 90;

function sla(i: ItemFila): string {
  if (i.slaEstourado) return "estourado";
  if (i.slaRestanteMin === null) return "respondida";
  const m = i.slaRestanteMin;
  return m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`;
}

export function Fila({ fila }: { fila: DadosPainel["fila"] }) {
  const total = fila.itens.length;
  const [processadas, setProcessadas] = useState(0);
  const [rodando, setRodando] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fichaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  function processar() {
    if (rodando) return;
    setAberta(null);
    setProcessadas(0);
    setRodando(true);
    let n = 0;
    timer.current = setInterval(() => {
      n++;
      setProcessadas(n);
      if (n >= total) {
        if (timer.current) clearInterval(timer.current);
        setRodando(false);
      }
    }, PASSO_MS);
  }

  function abrir(id: string) {
    setAberta((a) => (a === id ? null : id));
    setTimeout(() => fichaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  const feitas = fila.itens.slice(0, processadas);
  const n0 = feitas.filter((i) => i.caso.decisao.nivel_final === 0).length;
  const enviadas = feitas.filter((i) => i.caso.resposta.enviada).length;
  const item = fila.itens.find((i) => i.id === aberta) ?? null;
  const s = fila.sumario;

  return (
    <div className="space-y-6">
      <Cabecalho etiqueta="Fila de agora" titulo={`${total} conversas esperando`} frase="Segunda, 02/11, 08:00: aperte o botão e veja o agente decidir cada uma, na ordem do SLA." />

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={processar}
          disabled={rodando}
          className="rounded-full bg-azul px-6 py-3 font-semibold text-white shadow-sm hover:bg-azul-escuro focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ciano disabled:opacity-60"
        >
          {rodando ? "Processando…" : processadas === total ? "Processar de novo" : "Processar a fila"}
        </button>
        <p className="text-sm text-tinta" aria-live="polite">
          {processadas === 0
            ? "Resultado gravado do lote real."
            : `${processadas} de ${total} processadas · ${n0} no nível 0 · ${enviadas} respostas enviadas sem pessoa`}
        </p>
      </div>

      {processadas > 0 ? (
        <div className="rounded-[1.5rem] bg-creme p-5">
          <p className="mb-3 font-semibold text-azul">Nível final de cada conversa{processadas < total ? " (processando…)" : ""}</p>
          <BarraNiveis
            rotulo="Nível final das conversas processadas"
            contagem={[0, 1, 2].map((n) => feitas.filter((i) => i.caso.decisao.nivel_final === n).length) as [number, number, number]}
          />
        </div>
      ) : null}

      <Tabela legenda="Fila de agora">
        <thead>
          <tr>
            <th className={TH}>Conversa</th>
            <th className={TH}>Canal</th>
            <th className={TH}>Idade</th>
            <th className={TH}>SLA restante</th>
            <th className={TH}>Motivo (confiança do Jev)</th>
            <th className={TH}>Nível</th>
            <th className={TH}>Ação</th>
          </tr>
        </thead>
        <tbody>
          {fila.itens.map((i, k) => {
            const pronta = k < processadas;
            const c = i.caso.classificacao;
            return (
              <tr
                key={`${i.id}-${pronta ? "p" : "a"}`}
                onClick={pronta ? () => abrir(i.id) : undefined}
                className={`${pronta ? "surgir cursor-pointer hover:bg-creme" : ""} ${aberta === i.id ? "bg-creme" : ""}`}
              >
                <td className={TD}>
                  {pronta ? (
                    <button type="button" onClick={(e) => { e.stopPropagation(); abrir(i.id); }} className="font-semibold text-azul underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-azul" aria-expanded={aberta === i.id}>
                      {i.id}
                    </button>
                  ) : (
                    <span className="text-tinta-suave">{i.id}</span>
                  )}
                </td>
                <td className={TD}>{CANAL[i.canal] ?? i.canal}</td>
                <td className={`${TD} tabular-nums`}>{i.idadeH === null ? "—" : `${i.idadeH.toLocaleString("pt-BR")} h`}</td>
                <td className={`${TD} tabular-nums ${i.slaEstourado ? "font-semibold text-nivel-2" : ""}`}>{sla(i)}</td>
                <td className={TD}>
                  {pronta ? (
                    <>
                      {MOTIVO[c.motivo] ?? c.motivo}
                      {c.motivo !== "sem_demanda" && c.valida ? <span className="text-tinta-suave"> ({c.confianca.toLocaleString("pt-BR", { maximumFractionDigits: 2 })})</span> : null}
                    </>
                  ) : (
                    <span className="text-tinta-suave">—</span>
                  )}
                </td>
                <td className={TD}>{pronta ? <NivelChip nivel={i.caso.decisao.nivel_final as Nivel} curto /> : <span className="text-tinta-suave">—</span>}</td>
                <td className={TD}>{pronta ? nomeFerramenta(i.caso.decisao.ferramenta) : <span className="text-tinta-suave">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </Tabela>
      <Detalhes>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <li><Cartao><p className="text-2xl font-extrabold">{pct(s.pct_nivel_acao["0"])}</p><p className="text-sm text-tinta">das ações no nível 0</p></Cartao></li>
          <li><Cartao><p className="text-2xl font-extrabold">{s.respostas_enviadas} / {s.respostas_para_aprovacao}</p><p className="text-sm text-tinta">respostas enviadas / rascunhos para aprovação</p></Cartao></li>
          <li><Cartao><p className="text-2xl font-extrabold">{(s.tempo_medio_ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s</p><p className="text-sm text-tinta">por conversa ({(s.tempo_total_lote_ms / 1000).toFixed(0)} s o lote, concorrência {s.concorrencia})</p></Cartao></li>
          <li><Cartao><p className="text-2xl font-extrabold">{s.sistemas_acessados_por_conversa.toLocaleString("pt-BR")}</p><p className="text-sm text-tinta">sistemas consultados por conversa (humano: 1,83)</p></Cartao></li>
        </ul>
        <p className="text-sm text-tinta">O botão mostra o resultado gravado do lote real (AI Proxy de verdade); não chama o modelo de novo.</p>
        <Fonte>{fila.fonte}; idade e SLA de data/processed/fila_conversas.csv.</Fonte>
      </Detalhes>

      <div ref={fichaRef} className="scroll-mt-24">
        {item ? (
          <section aria-label={`Ficha do caso ${item.id}`} className="rounded-3xl border-2 border-azul p-4 sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="text-xl font-extrabold text-azul">Ficha do caso</h3>
              <button type="button" onClick={() => setAberta(null)} className="rounded-full border border-azul px-4 py-1 text-sm font-semibold text-azul hover:bg-creme">
                Fechar
              </button>
            </div>
            <FichaCaso caso={item.caso} ficha={item.ficha} />
          </section>
        ) : processadas > 0 ? (
          <p className="text-sm text-tinta-suave">Clique numa conversa para ver a ficha do caso.</p>
        ) : null}
      </div>
    </div>
  );
}
