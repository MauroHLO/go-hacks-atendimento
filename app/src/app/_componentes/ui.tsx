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
  return <p className="mt-2 text-xs text-tinta-suave [overflow-wrap:anywhere]">Fonte: {children}</p>;
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
