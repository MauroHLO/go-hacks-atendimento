"use client";

// Casos do histórico: os 3 casos de casos_demo.json (npm run casos-demo), escolhidos por critério fixo e
// processados pelo orquestrador real na data da conversa. A fila de agora não tem anexos; estes têm.

import { useState } from "react";
import type { DadosPainel } from "@/lib/painel/dados";
import { FichaCaso } from "./FichaCaso";
import { Cabecalho, dataCurta, Detalhes, Fonte, NivelChip, type Nivel } from "./ui";

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
      <Cabecalho etiqueta="Casos do histórico" titulo="Três desfechos" frase="O mesmo agente resolve sozinho, sinaliza ao supervisor ou aciona a qualidade, conforme a evidência." />
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
      <Detalhes>
        <p className="text-sm text-tinta">Conversas do histórico (dados sintéticos), escolhidas por critério fixo: a primeira, em ordem cronológica, que atende ao critério. A ficha é montada na data da conversa, sem informação do futuro; a fila de agora não tem anexos, estes têm.</p>
        <Fonte>data/processed/casos_demo.json (npm run casos-demo, AI Proxy real)</Fonte>
      </Detalhes>
    </div>
  );
}
