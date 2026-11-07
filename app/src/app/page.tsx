import Image from "next/image";

// Página provisória: a interface (fila priorizada, ficha do caso, painel de causa-raiz e impacto)
// entra nos próximos commits. Os componentes do projeto de referência foram removidos (docs/decisoes.md, seção 2).

const MODULOS = [
  ["Visão única do pedido", "ERP, transportadora, gateway, OMS, CRM e anexos numa ficha só."],
  ["Classificador", "O modelo lê a conversa e devolve motivos e campos; texto do cliente é dado, nunca instrução."],
  ["Verificador de evidências", "Sinais explicáveis de suspeita nas fotos e no histórico do cliente."],
  ["Motor de política", "Código determinístico decide o nível: 0 resolve, 1 pessoa aprova, 2 pessoa obrigatória."],
  ["Causa-raiz e contatos evitáveis", "Recontatos por transportadora, campanha, máquina, lote e cobrança duplicada."],
] as const;

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
      <header className="space-y-3 border-b-2 border-marca pb-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Image src="/gogroup-logo.png" alt="Gogroup" width={98} height={28} />
          <p className="text-sm text-zinc-700">GoHacks Talent 2026, Desafio 1. Não é um produto oficial da Gogroup.</p>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-marca sm:text-3xl">Agente de atendimento: Gocase e GoBeauté</h1>
        <p className="text-lg text-zinc-900">O modelo entende e redige; o código decide o que se resolve sozinho e o que precisa de uma pessoa.</p>
      </header>
      <ol className="mt-6 space-y-3">
        {MODULOS.map(([nome, texto], i) => (
          <li key={nome} className="rounded-md border border-zinc-200 bg-white px-4 py-3">
            <p className="font-medium text-zinc-900">
              {i + 1}. {nome}
            </p>
            <p className="text-sm text-zinc-700">{texto}</p>
          </li>
        ))}
      </ol>
      <p role="note" className="mt-6 text-sm text-zinc-700">
        Interface em construção. Dados de demonstração são fictícios.
      </p>
    </main>
  );
}
