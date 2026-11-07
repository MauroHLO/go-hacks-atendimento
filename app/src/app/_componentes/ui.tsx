// Peças visuais do brandbook Gogroup: etiqueta de título em pílula (limão, texto azul-escuro), cartão creme
// com texto azul, nível com número no círculo e rótulo em texto escuro (nunca só a cor), fonte de cada número.
// Os nomes de classe ficam escritos por inteiro para o Tailwind encontrá-los.

import type { ReactNode } from "react";

export type Nivel = 0 | 1 | 2;

export const COR_NIVEL: Record<Nivel, string> = { 0: "bg-nivel-0 text-white", 1: "bg-nivel-1 text-tinta", 2: "bg-nivel-2 text-white" };
export const FUNDO_NIVEL: Record<Nivel, string> = { 0: "bg-nivel-0", 1: "bg-nivel-1", 2: "bg-nivel-2" };
export const CLARO_NIVEL: Record<Nivel, string> = { 0: "bg-nivel-0-claro", 1: "bg-nivel-1-claro", 2: "bg-nivel-2-claro" };
export const NOME_NIVEL: Record<Nivel, string> = {
  0: "agente resolve",
  1: "pessoa aprova",
  2: "pessoa obrigatória",
};

export function Pilula({ children, como = "span" }: { children: ReactNode; como?: "span" | "h2" | "h3" }) {
  const Tag = como;
  return (
    <Tag className="inline-block rounded-full bg-limao px-3 py-0.5 text-sm font-semibold text-azul-escuro">{children}</Tag>
  );
}

export function Titulo({ etiqueta, children, sub }: { etiqueta?: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="space-y-2">
      {etiqueta ? <Pilula>{etiqueta}</Pilula> : null}
      <h2 className="text-2xl font-extrabold tracking-tight text-azul sm:text-3xl">{children}</h2>
      {sub ? <p className="max-w-3xl text-tinta-suave">{sub}</p> : null}
    </div>
  );
}

export function Subtitulo({ children }: { children: ReactNode }) {
  return <h3 className="text-lg font-semibold text-azul">{children}</h3>;
}

export function Cartao({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-creme p-4 text-azul sm:p-5 ${className}`}>{children}</div>;
}

export function Fonte({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-xs text-zinc-500 [overflow-wrap:anywhere]">Fonte: {children}</p>;
}

// Bloco recolhível para o detalhe técnico (fontes, caminhos, tabelas longas).
export function Detalhes({ children, rotulo = "Ver detalhes", aberto = false }: { children: ReactNode; rotulo?: string; aberto?: boolean }) {
  return (
    <details open={aberto} className="group rounded-2xl border border-zinc-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-azul hover:bg-creme focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ciano [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">▸</span>
        {rotulo}
      </summary>
      <div className="space-y-4 px-4 pb-4">{children}</div>
    </details>
  );
}

// Cabeçalho de aba: etiqueta, título curto e UMA frase.
export function Cabecalho({ etiqueta, titulo, frase }: { etiqueta: string; titulo: ReactNode; frase: ReactNode }) {
  return (
    <div className="space-y-2">
      <Pilula>{etiqueta}</Pilula>
      <h2 className="text-3xl font-extrabold tracking-tight text-azul sm:text-4xl">{titulo}</h2>
      <p className="max-w-2xl text-lg text-tinta">{frase}</p>
    </div>
  );
}

// Ícones de traço (24×24), decorativos: o texto ao lado sempre diz o que é.
const TRACOS: Record<string, ReactNode> = {
  conversa: <path d="M4 5h16v11H9l-5 4V5z" />,
  ficha: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  jev: <path d="M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4L12 3zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15z" />,
  evidencias: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  politica: <path d="M12 4v16M6 20h12M5 8h14M5 8l-2.5 6a3 3 0 005 0L5 8zM19 8l-2.5 6a3 3 0 005 0L19 8z" />,
  ferramentas: <path d="M14.7 6.3a4 4 0 00-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 005.2-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6z" />,
  resposta: (
    <>
      <path d="M4 5h16v11H9l-5 4V5z" />
      <path d="M8.5 10.5l2 2 4-4" />
    </>
  ),
  robo: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5" />
    </>
  ),
  aprova: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0114 0M15.5 15.5l1.5 1.5 3-3" />
    </>
  ),
  pessoa: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0114 0M12 12v0" />
      <path d="M19 4v4M19 10.5v.5" />
    </>
  ),
};

export function Icone({ nome, className = "h-6 w-6" }: { nome: keyof typeof TRACOS; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {TRACOS[nome]}
    </svg>
  );
}

// Barra 100% empilhada por nível, com rótulo direto (número e %), 2 px entre segmentos.
export function BarraNiveis({ contagem, rotulo }: { contagem: [number, number, number]; rotulo: string }) {
  const total = contagem.reduce((a, b) => a + b, 0) || 1;
  const texto: Record<Nivel, string> = { 0: "text-white", 1: "text-tinta", 2: "text-white" };
  return (
    <div className="space-y-2">
      <div className="flex h-12 w-full gap-[2px]" role="img" aria-label={`${rotulo}: ${contagem.map((n, i) => `nível ${i}: ${n}`).join(", ")}`}>
        {contagem.map((n, i) =>
          n > 0 ? (
            <div
              key={i}
              title={`Nível ${i}: ${n} (${pct((n / total) * 100, 0)})`}
              className={`flex h-full items-center justify-center overflow-hidden text-sm font-semibold first:rounded-l-lg last:rounded-r-lg ${FUNDO_NIVEL[i as Nivel]} ${texto[i as Nivel]}`}
              style={{ width: `${(n / total) * 100}%`, minWidth: 6 }}
            >
              {n / total >= 0.08 ? n : ""}
            </div>
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {contagem.map((n, i) => (
          <li key={i}>
            <NivelChip nivel={i as Nivel} curto /> <span className="tabular-nums text-tinta">· {n} ({pct((n / total) * 100, 0)})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Antes × depois em barras horizontais (0 a 100%), rótulo direto no fim de cada barra.
export function AntesDepois({ titulo, antes, depois }: { titulo: string; antes: number; depois: number }) {
  return (
    <div className="space-y-2" role="img" aria-label={`${titulo}: vigente ${pct(antes)}, nova política ${pct(depois)}`}>
      <p className="font-semibold text-azul">{titulo}</p>
      {[
        ["Vigente", antes, "bg-zinc-300"],
        ["Ponta Firme", depois, "bg-azul"],
      ].map(([nome, v, cor]) => (
        <div key={nome as string} className="grid grid-cols-[6.5rem_1fr] items-center gap-3 text-sm">
          <span className="text-tinta">{nome}</span>
          <div className="flex items-center gap-2">
            <div className={`h-6 rounded-r-md ${cor}`} style={{ width: `${(v as number) * 0.85}%` }} />
            <span className="font-semibold tabular-nums text-tinta">{pct(v as number)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function NivelChip({ nivel, curto = false }: { nivel: Nivel; curto?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-tinta">
      <span aria-hidden="true" className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ${COR_NIVEL[nivel]}`}>
        {nivel}
      </span>
      Nível {nivel}
      {curto ? null : <span className="font-normal text-tinta-suave">· {NOME_NIVEL[nivel]}</span>}
    </span>
  );
}

export function Tabela({ children, legenda }: { children: ReactNode; legenda?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200">
      <table className="w-full min-w-max border-collapse text-left text-sm">
        {legenda ? <caption className="sr-only">{legenda}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export const TH = "border-b border-zinc-200 bg-creme px-3 py-2 font-semibold text-azul";
export const TD = "border-b border-zinc-100 px-3 py-2 align-top";

export function pct(v: number, casas = 1): string {
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

export const CANAL: Record<string, string> = { whatsapp: "WhatsApp", email: "E-mail", reclame_aqui: "Reclame Aqui" };

export const MOTIVO: Record<string, string> = {
  rastreio: "Rastreio",
  atraso: "Atraso",
  avaria: "Avaria",
  item_faltante: "Item faltante",
  brinde: "Brinde",
  erro_personalizacao: "Erro de personalização",
  troca_fragrancia: "Troca de fragrância",
  cancelamento: "Cancelamento",
  reacao_adversa: "Reação adversa",
  cobranca_duplicada: "Cobrança em dobro",
  pagamento_pendente: "Pagamento pendente",
  duvida_produto: "Dúvida de produto",
  cupom: "Cupom",
  endereco: "Endereço",
  elogio: "Elogio",
  sem_demanda: "Sem demanda",
  outro: "Outro",
};

export function dataCurta(d: string): string {
  const [a, m, di] = d.slice(0, 10).split("-");
  return `${di}/${m}/${a}${d.length > 10 ? ` ${d.slice(11, 16)}` : ""}`;
}

export function nomeFerramenta(f: string): string {
  return f.replaceAll("_", " ");
}
