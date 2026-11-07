import type { DadosPainel } from "@/lib/painel/dados";
import { AntesDepois, Cartao, Detalhes, Fonte, Icone, pct, Subtitulo } from "./ui";

const FLUXO = [
  ["conversa", "Conversa", "dados pessoais mascarados"],
  ["ficha", "Ficha única", "6 sistemas numa tela"],
  ["jev", "Jev", "classifica, não decide"],
  ["evidencias", "Evidências", "foto, EXIF, prazo"],
  ["politica", "Política", "o código decide o nível"],
  ["ferramentas", "Ferramentas", "26, com limite e log"],
  ["resposta", "Resposta", "checada antes de sair"],
] as const;

const NIVEIS = [
  { n: 0, icone: "robo", titulo: "Nível 0", frase: "O agente resolve e responde sozinho.", cor: "border-nivel-0", fundo: "bg-nivel-0 text-white" },
  { n: 1, icone: "aprova", titulo: "Nível 1", frase: "O agente prepara; uma pessoa aprova.", cor: "border-nivel-1", fundo: "bg-nivel-1 text-tinta" },
  { n: 2, icone: "pessoa", titulo: "Nível 2", frase: "Uma pessoa assume: suspeita, reação adversa ou falha.", cor: "border-nivel-2", fundo: "bg-nivel-2 text-white" },
] as const;

const arred = (v: number) => `${Math.round(v)}%`;

export function VisaoGeral({ v }: { v: DadosPainel["visao"] }) {
  const r = v.resultado;
  return (
    <div className="space-y-14">
      <section className="overflow-hidden rounded-[2rem] bg-azul px-6 py-10 text-white sm:px-10 sm:py-14">
        <p className="inline-block rounded-full bg-limao px-3 py-0.5 text-sm font-semibold text-azul-escuro">Ponta Firme</p>
        <h2 className="mt-4 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">Se compromete, cumpre e cumpre bem.</h2>
        <ul className="mt-10 grid gap-8 sm:grid-cols-3">
          <li>
            <p className="text-5xl font-extrabold tabular-nums text-limao sm:text-6xl">
              {arred(r.semPessoa.vigente)}
              <span className="text-3xl text-white sm:text-4xl"> → </span>
              {arred(r.semPessoa.nova)}
            </p>
            <p className="mt-2 text-lg font-semibold">das conversas sem nenhuma pessoa</p>
          </li>
          <li>
            <p className="text-5xl font-extrabold tabular-nums text-limao sm:text-6xl">{Math.round(r.horas.nova)} h</p>
            <p className="mt-2 text-lg font-semibold">liberadas por mês</p>
          </li>
          <li>
            <p className="text-5xl font-extrabold tabular-nums text-limao sm:text-6xl">{arred(r.sozinho.nova)}</p>
            <p className="mt-2 text-lg font-semibold">das ações executadas sozinho</p>
          </li>
        </ul>
      </section>

      <section className="grid gap-8 rounded-[2rem] bg-creme p-6 sm:p-8 lg:grid-cols-2">
        <AntesDepois titulo="Conversas sem nenhuma pessoa" antes={r.semPessoa.vigente} depois={r.semPessoa.nova} />
        <AntesDepois titulo="Ações executadas sozinho" antes={r.sozinho.vigente} depois={r.sozinho.nova} />
        <p className="text-sm text-tinta lg:col-span-2">
          A diferença entre as duas é a resposta pública do Reclame Aqui: a ação sai sozinha, mas uma pessoa aprova o texto.
        </p>
      </section>

      <section className="space-y-6">
        <h2 className="text-3xl font-extrabold tracking-tight text-azul">Como uma conversa anda</h2>
        <ol className="relative grid grid-cols-1 gap-6 sm:grid-cols-4 lg:grid-cols-7" aria-label="Fluxo do agente">
          <span aria-hidden="true" className="absolute left-0 right-0 top-8 hidden h-1 rounded bg-ciano lg:block" />
          {FLUXO.map(([icone, nome, frase]) => (
            <li key={nome} className="relative flex items-center gap-4 lg:flex-col lg:text-center">
              <span
                className={`relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${
                  icone === "politica" ? "bg-azul text-white" : icone === "jev" || icone === "resposta" ? "bg-ciano text-azul-escuro" : "bg-creme text-azul"
                }`}
              >
                <Icone nome={icone} className="h-8 w-8" />
              </span>
              <span>
                <span className="block font-extrabold text-azul">{nome}</span>
                <span className="block text-sm text-tinta">{frase}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="text-sm text-zinc-500">Em ciano, onde entra o modelo; em azul, a decisão, sempre do código.</p>
      </section>

      <section className="space-y-6">
        <h2 className="text-3xl font-extrabold tracking-tight text-azul">Três níveis</h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {NIVEIS.map((n) => (
            <li key={n.n} className={`rounded-[1.5rem] border-t-8 bg-creme p-6 ${n.cor}`}>
              <span className={`flex h-14 w-14 items-center justify-center rounded-full ${n.fundo}`}>
                <Icone nome={n.icone} className="h-7 w-7" />
              </span>
              <p className="mt-4 text-2xl font-extrabold text-azul">{n.titulo}</p>
              <p className="mt-1 text-lg text-tinta">{n.frase}</p>
            </li>
          ))}
        </ul>
      </section>

      <Detalhes rotulo="Ver os números e as fontes">
        <div className="space-y-3">
          <Subtitulo>O problema</Subtitulo>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {v.problema.map((p) => (
              <li key={p.rotulo}>
                <Cartao className="h-full">
                  <p className="text-2xl font-extrabold tabular-nums">{p.valor}</p>
                  <p className="mt-1 font-semibold">{p.rotulo}</p>
                  <p className="mt-1 text-sm text-tinta-suave">{p.detalhe}</p>
                </Cartao>
              </li>
            ))}
          </ul>
          <Fonte>{v.problema[0].fonte}</Fonte>
        </div>
        <div className="space-y-2 text-sm text-tinta">
          <Subtitulo>O resultado, explicado</Subtitulo>
          <p>
            <strong>Conversas sem nenhuma pessoa</strong>: ação no nível 0 e resposta enviada sem aprovação. Ficam de fora as {r.semPessoa.semDemanda} conversas em que o cliente não escreveu nada (o bot já as encerrava); com elas no denominador, {pct(r.semPessoa.vigenteTodas)} → {pct(r.semPessoa.novaTodas)}.
          </p>
          <p>
            <strong>Ações executadas sozinho</strong>: {pct(r.sozinho.vigente)} → {pct(r.sozinho.nova)}. Inclui a ação do Reclame Aqui, cuja resposta pública uma pessoa aprova.
          </p>
          <p>
            <strong>Horas liberadas por mês</strong>: {r.horas.vigente.toLocaleString("pt-BR")} → {r.horas.nova.toLocaleString("pt-BR")}, pelos minutos medidos por conversa; conversa sem demanda conta zero hora.
          </p>
          <p>
            <strong>Casos com sinal forte sinalizados ao supervisor</strong>: {r.sinalizadosMes} por mês ({r.sinalizadosAmostra} na amostra). O cliente recebe só &quot;em análise&quot;; o agente nunca nega por suspeita.
          </p>
          <Fonte>{r.fonte}</Fonte>
        </div>
      </Detalhes>
    </div>
  );
}
