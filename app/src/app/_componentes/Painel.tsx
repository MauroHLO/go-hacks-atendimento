"use client";

// Página única com abas. A aba aberta fica no endereço (#fila, #autonomia...) para poder ser compartilhada.

import { useEffect, useState } from "react";
import type { DadosPainel } from "@/lib/painel/dados";
import { Analista } from "./Analista";
import { Autonomia } from "./Autonomia";
import { Casos } from "./Casos";
import { Conferencia } from "./Conferencia";
import { Fila } from "./Fila";
import { TesteAoVivo } from "./TesteAoVivo";
import { VisaoGeral } from "./VisaoGeral";

const ABAS = [
  ["visao", "Visão geral"],
  ["fila", "Fila de agora"],
  ["casos", "Casos do histórico"],
  ["analista", "Agente analista"],
  ["autonomia", "Autonomia"],
  ["conferencia", "Como conferimos a IA"],
  ["ao-vivo", "Teste ao vivo"],
] as const;
type Aba = (typeof ABAS)[number][0];

export function Painel({ dados }: { dados: DadosPainel }) {
  const [aba, setAba] = useState<Aba>("visao");

  useEffect(() => {
    const ler = () => {
      const h = window.location.hash.slice(1);
      if (ABAS.some(([id]) => id === h)) setAba(h as Aba);
    };
    ler();
    window.addEventListener("hashchange", ler);
    return () => window.removeEventListener("hashchange", ler);
  }, []);

  function ir(id: Aba) {
    setAba(id);
    history.replaceState(null, "", `#${id}`);
  }

  const fichas = Object.fromEntries(dados.fila.itens.map((i) => [i.id, i.ficha]));

  return (
    <>
      <nav aria-label="Abas" className="sticky z-10 -mx-4 overflow-x-auto border-b border-zinc-200 bg-white/95 px-4 backdrop-blur sm:-mx-6 sm:px-6" style={{ top: "env(safe-area-inset-top, 0px)" }}>
        <ul role="tablist" className="flex min-w-max gap-1 py-2">
          {ABAS.map(([id, nome]) => (
            <li key={id}>
              <button
                type="button"
                role="tab"
                id={`aba-${id}`}
                aria-selected={aba === id}
                aria-controls={`painel-${id}`}
                onClick={() => ir(id)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ciano ${aba === id ? "bg-azul text-white" : "text-azul hover:bg-creme"}`}
              >
                {nome}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div role="tabpanel" id={`painel-${aba}`} aria-labelledby={`aba-${aba}`} className="py-8">
        {aba === "visao" ? <VisaoGeral v={dados.visao} /> : null}
        {aba === "fila" ? <Fila fila={dados.fila} /> : null}
        {aba === "casos" ? <Casos casos={dados.casos} /> : null}
        {aba === "analista" ? <Analista a={dados.analista} /> : null}
        {aba === "autonomia" ? <Autonomia a={dados.autonomia} /> : null}
        {aba === "conferencia" ? <Conferencia c={dados.conferencia} fila={dados.fila.sumario} /> : null}
        {aba === "ao-vivo" ? <TesteAoVivo conversas={dados.conversasTeste} fichas={fichas} /> : null}
      </div>
    </>
  );
}
