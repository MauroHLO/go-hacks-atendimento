import type { DadosPainel } from "@/lib/painel/dados";
import { Cabecalho, dataCurta, Detalhes, Fonte, Icone } from "./ui";

const TIPO: Record<string, string> = {
  transportadora_uf: "Transportadora × UF",
  brinde_campanha: "Brinde da campanha",
  cobranca_duplicada: "Cobrança em dobro",
};

// Número de destaque de cada incidente.
function destaque(i: DadosPainel["analista"]["incidentes"][number]): { valor: string; texto: string } {
  if (i.tipo === "cobranca_duplicada") return { valor: String(i.pedidosAfetados), texto: "estornos preparados (direito comprovado pelo gateway)" };
  const hoje = i.avisos.filter((a) => a.executado).reduce((s, a) => s + a.pedidos, 0);
  return { valor: String(hoje), texto: `avisos enviados hoje, de ${i.pedidosAfetados} pedidos abertos afetados` };
}

export function Analista({ a }: { a: DadosPainel["analista"] }) {
  const usado = Math.min(100, Math.round((a.avisosHoje / a.limiteDia) * 100));
  return (
    <div className="space-y-8">
      <Cabecalho etiqueta="Agente analista" titulo="Avisar antes que o cliente escreva" frase="Quando um problema se repete, o agente abre o incidente e avisa os clientes afetados, só com consentimento." />

      <section className="rounded-[2rem] bg-azul p-6 text-white sm:p-8">
        <p className="text-lg font-semibold">Avisos proativos hoje</p>
        <p className="mt-1 text-6xl font-extrabold tabular-nums text-limao">
          {a.avisosHoje}
          <span className="text-2xl font-semibold text-white"> de {a.limiteDia} por dia</span>
        </p>
        <div className="mt-4 h-4 w-full overflow-hidden rounded-full bg-azul-escuro" role="img" aria-label={`${a.avisosHoje} de ${a.limiteDia} avisos usados hoje`}>
          <div className="h-full rounded-full bg-limao" style={{ width: `${usado}%` }} />
        </div>
      </section>

      <ul className="grid gap-4 lg:grid-cols-3">
        {a.incidentes.map((i) => {
          const d = destaque(i);
          return (
            <li key={i.referencia ?? i.escopo} className="flex flex-col gap-3 rounded-[1.5rem] border-t-8 border-azul bg-creme p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">{TIPO[i.tipo] ?? i.tipo}</p>
              <h3 className="text-xl font-extrabold leading-snug text-azul">{i.escopo}</h3>
              <p className="text-5xl font-extrabold tabular-nums text-azul">{d.valor}</p>
              <p className="text-sm text-tinta">{d.texto}</p>
              <p className="mt-auto flex items-center gap-2 text-sm font-semibold text-tinta">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-azul text-white">
                  <Icone nome="ferramentas" className="h-4 w-4" />
                </span>
                Incidente {i.referencia ?? "não aberto"}
              </p>
            </li>
          );
        })}
      </ul>

      <Detalhes>
        {a.incidentes.map((i) => (
          <div key={i.escopo} className="space-y-1 text-sm text-tinta">
            <p className="font-semibold text-azul">
              {i.escopo} ({i.referencia})
            </p>
            <ul className="list-disc space-y-0.5 pl-5">
              {i.evidencias.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            {i.acao ? <p>{i.acao}.</p> : null}
            {i.tipo !== "cobranca_duplicada" ? (
              <p>
                {i.pedidosAfetados} pedidos abertos afetados; {i.semConsentimento} sem consentimento (não recebem aviso).{" "}
                {i.avisos.map((v) => `${dataCurta(v.dia)}: ${v.pedidos} avisos ${v.executado ? `enviados (${v.referencia})` : "preparados"}`).join("; ")}
              </p>
            ) : (
              <p>Sem aviso em massa: o cliente recebe a resposta do próprio estorno.</p>
            )}
          </div>
        ))}
        <p className="text-sm text-tinta">
          Um pedido afetado por dois incidentes recebe um aviso só. Os pedidos são da amostra de 1 em 4: no volume real seriam cerca de 4 vezes mais, e o limite de 300 por dia espalharia os avisos por vários dias.
        </p>
        <Fonte>{a.fonte}. Regras: recontato da transportadora × UF ≥ 2× o das demais e ≥ 30 conversas; brinde com ≥ 25% de &quot;Produto faltando&quot;; cobrança em dobro sem estorno no gateway.</Fonte>
      </Detalhes>
    </div>
  );
}
