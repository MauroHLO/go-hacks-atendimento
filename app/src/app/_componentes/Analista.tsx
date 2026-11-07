import type { DadosPainel } from "@/lib/painel/dados";
import { Cartao, dataCurta, Fonte, Subtitulo, Titulo } from "./ui";

const TIPO: Record<string, string> = {
  transportadora_uf: "Transportadora × UF",
  brinde_campanha: "Brinde da campanha",
  cobranca_duplicada: "Cobrança em dobro",
};

export function Analista({ a }: { a: DadosPainel["analista"] }) {
  const usado = Math.min(100, Math.round((a.avisosHoje / a.limiteDia) * 100));
  return (
    <div className="space-y-6">
      <Titulo
        etiqueta="Agente analista"
        sub="Lê os agregados de causa-raiz, abre incidente quando a regra mede um desvio e avisa os clientes ainda não afetados, antes que eles escrevam. Só com consentimento do CRM e no máximo 300 avisos por dia."
      >
        Contatos evitáveis
      </Titulo>

      <Cartao>
        <p className="font-semibold">Avisos proativos hoje</p>
        <p className="mt-1 text-4xl font-extrabold tabular-nums">
          {a.avisosHoje} <span className="text-xl font-semibold">de {a.limiteDia} por dia</span>
        </p>
        <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-white" role="img" aria-label={`${a.avisosHoje} de ${a.limiteDia} avisos usados hoje`}>
          <div className="h-full rounded-full bg-azul" style={{ width: `${usado}%` }} />
        </div>
        <p className="mt-2 text-sm text-tinta">
          Só pedidos ainda abertos, só clientes que aceitam WhatsApp ou e-mail; um pedido afetado por dois incidentes recebe um aviso só. Os pedidos são da amostra de 1 em 4: no volume real seriam cerca de 4 vezes mais, e o limite espalharia os avisos por vários dias.
        </p>
      </Cartao>

      <ul className="grid gap-4 lg:grid-cols-3">
        {a.incidentes.map((i) => (
          <li key={i.referencia ?? i.escopo} className="flex flex-col rounded-2xl border-2 border-azul p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">
              {TIPO[i.tipo] ?? i.tipo} · {i.referencia ?? "não aberto"}
            </p>
            <h3 className="mt-1 text-lg font-extrabold text-azul">{i.escopo}</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-tinta">
              {i.evidencias.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            <div className="mt-auto space-y-1 pt-3 text-sm">
              <Subtitulo>Ação</Subtitulo>
              <p className="text-tinta">Incidente aberto ({i.referencia}).</p>
              {i.acao ? <p className="text-tinta">{i.acao}.</p> : null}
              {i.tipo !== "cobranca_duplicada" ? (
                <>
                  <p className="text-tinta">
                    {i.pedidosAfetados} pedidos abertos afetados; {i.semConsentimento} sem consentimento (não recebem aviso).
                  </p>
                  {i.avisos.map((v) => (
                    <p key={v.dia} className="font-medium text-tinta">
                      {dataCurta(v.dia)}: {v.pedidos} avisos {v.executado ? `enviados (${v.referencia})` : "preparados"}
                    </p>
                  ))}
                </>
              ) : (
                <p className="text-tinta-suave">Sem aviso em massa: o cliente recebe a resposta do próprio estorno.</p>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Fonte>{a.fonte}. Regras: recontato da transportadora × UF ≥ 2× o das demais e ≥ 30 conversas; brinde com ≥ 25% de &quot;Produto faltando&quot;; cobrança em dobro sem estorno no gateway.</Fonte>
    </div>
  );
}
