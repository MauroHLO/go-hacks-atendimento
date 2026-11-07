import Image from "next/image";
import { montarPainel } from "@/lib/painel/dados";
import { Painel } from "./_componentes/Painel";

const GITHUB = "https://github.com/gohacks20-code/go-hacks-atendimento";

export default function Home() {
  const dados = montarPainel();
  return (
    <div className="flex min-h-full flex-1 flex-col overflow-x-clip">
      <header className="bg-azul text-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-lg bg-white px-2 py-1">
                <Image src="/gogroup-logo.png" alt="Gogroup" width={98} height={28} priority />
              </span>
              <span className="rounded-full bg-limao px-3 py-0.5 text-sm font-semibold text-azul-escuro">GoHacks Talent 2026 · Desafio 1</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Ponta Firme</h1>
            <p className="max-w-2xl text-base font-semibold text-white sm:text-lg">O agente de atendimento que resolve sozinho onde é seguro e chama uma pessoa só onde ela faz diferença.</p>
            <p className="max-w-2xl text-sm text-white">Gocase e GoBeauté. O modelo classifica e redige; o código decide.</p>
          </div>
          <a href={GITHUB} target="_blank" rel="noreferrer" className="rounded-full border-2 border-white px-4 py-2 text-sm font-semibold text-white hover:bg-white hover:text-azul focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ciano">
            Código no GitHub
          </a>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        <Painel dados={dados} />
      </main>
      <footer className="border-t-4 border-limao bg-creme">
        <div className="mx-auto w-full max-w-6xl px-4 py-5 text-sm text-azul sm:px-6">
          <p className="font-semibold">Dados sintéticos fornecidos pela Gogroup para o GoHacks Talent 2026</p>
          <p className="mt-1 text-tinta-suave">Não é um produto oficial da Gogroup. Ações das ferramentas são simuladas; nenhum cliente real é contatado.</p>
        </div>
      </footer>
    </div>
  );
}
