"use client";

// Casos do histórico: os 3 casos de casos_demo.json (npm run casos-demo), escolhidos por critério fixo e
// processados pelo orquestrador real na data da conversa. A fila de agora não tem anexos; estes têm.

import { useState } from "react";
import type { DadosPainel } from "@/lib/painel/dados";
import { FichaCaso } from "./FichaCaso";
import { dataCurta, Fonte, NivelChip, Titulo, type Nivel } from "./ui";

const TITULO: Record<string, string> = {
  avaria_sem_sinal: "Avaria sem sinal",
  hash_outro_cliente: "Foto repetida de outro cliente",
  reacao_adversa: "Reação adversa",
};

export function Casos({ casos }: { casos: DadosPainel["casos"] }) {
  const [i, setI] = useState(0);
  const c = casos[i];
  return (
    <div className="space-y-6">
      <Titulo etiqueta="Casos do histórico" sub="Três conversas reais da amostra (dados sintéticos), uma por desfecho: resolve sozinho, sinaliza ao supervisor e aciona a qualidade. A ficha é montada na data da conversa, sem informação do futuro.">
        O mesmo agente em três situações
      </Titulo>
      <div role="tablist" aria-label="Casos" className="flex flex-wrap gap-2">
        {casos.map((x, k) => (
          <button
            key={x.tipo}
            role="tab"
            type="button"
            aria-selected={k === i}
            onClick={() => setI(k)}
            className={`flex items-center gap-2 rounded-2xl border-2 px-4 py-2 text-left ${k === i ? "border-azul bg-creme" : "border-zinc-200 hover:border-azul"}`}
          >
            <span className="font-semibold text-azul">{TITULO[x.tipo] ?? x.tipo}</span>
            <NivelChip nivel={x.caso.decisao.nivel_final as Nivel} curto />
          </button>
        ))}
      </div>
      <div className="space-y-1 text-sm text-tinta">
        <p>{c.descricao}</p>
        <p className="text-tinta-suave">
          Decidido em {dataCurta(c.momento)} · tag do atendente: {c.tag}
        </p>
      </div>
      <FichaCaso caso={c.caso} ficha={c.ficha} />
      <Fonte>data/processed/casos_demo.json (npm run casos-demo, AI Proxy real)</Fonte>
    </div>
  );
}
