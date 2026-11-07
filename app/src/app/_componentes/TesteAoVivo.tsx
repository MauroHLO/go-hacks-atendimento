"use client";

// Teste ao vivo: uma conversa da fila (ou uma mensagem fictícia ligada ao pedido dela) → POST /api/agent →
// ficha completa. A chave do AI Proxy fica só no servidor; a rota exige mesma origem, aceita até 2.000
// caracteres, aplica os limites de lib/limites e, se o proxy falhar, devolve o resultado gravado com aviso.

import { useState, type FormEvent } from "react";
import type { Resumo } from "@/lib/agent/resumo";
import type { DadosPainel, LinhaFicha } from "@/lib/painel/dados";
import { FichaCaso } from "./FichaCaso";
import { CANAL, MOTIVO, Titulo } from "./ui";

const LIMITE = 2_000;

type Estado =
  | { tipo: "ocioso" }
  | { tipo: "carregando" }
  | { tipo: "ok"; id: string; caso: Resumo; aviso: string | null; ms: number; teste: boolean }
  | { tipo: "erro"; texto: string };

const EXEMPLOS = [
  "Oi! Meu pedido já passou da data prometida e ainda não chegou. O que aconteceu?",
  "Quero cancelar a compra, me arrependi.",
  "A caixa chegou amassada e o produto veio quebrado.",
];

export function TesteAoVivo({ conversas, fichas }: { conversas: DadosPainel["conversasTeste"]; fichas: Record<string, LinhaFicha[]> }) {
  const [id, setId] = useState(conversas[0]?.id ?? "");
  const [mensagem, setMensagem] = useState("");
  const [estado, setEstado] = useState<Estado>({ tipo: "ocioso" });

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    if (estado.tipo === "carregando" || !id) return;
    setEstado({ tipo: "carregando" });
    const inicio = performance.now();
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: id, mensagem: mensagem.trim() || null }),
      });
      const corpo = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const ms = Math.round(performance.now() - inicio);
      if (res.status === 200 && corpo?.caso) {
        const cont = corpo.contingencia as { aviso?: string } | undefined;
        setEstado({ tipo: "ok", id, caso: corpo.caso as Resumo, aviso: cont?.aviso ?? null, ms, teste: corpo.teste === true });
      } else if (res.status === 200) {
        setEstado({ tipo: "erro", texto: "O agente não conseguiu processar agora e não há resultado gravado para esta conversa. Na operação, o caso iria para uma pessoa (nível 2)." });
      } else if (res.status === 429) {
        setEstado({ tipo: "erro", texto: "Limite de requisições da demonstração atingido. Tente de novo em alguns minutos." });
      } else if (res.status === 413 || res.status === 400) {
        setEstado({ tipo: "erro", texto: `Entrada recusada pela rota (use até ${LIMITE.toLocaleString("pt-BR")} caracteres).` });
      } else {
        setEstado({ tipo: "erro", texto: `A rota respondeu ${res.status}.` });
      }
    } catch {
      setEstado({ tipo: "erro", texto: "Sem conexão com a rota." });
    }
  }

  const campo = "w-full rounded-xl border-2 border-zinc-300 bg-white px-3 py-2 text-tinta focus:border-azul focus:outline-none";
  return (
    <div className="space-y-6">
      <Titulo
        etiqueta="Teste ao vivo"
        sub="Escolha uma conversa da fila e rode o agente de verdade: Jev, ficha, evidências, motor de política, ferramentas simuladas e redação checada. Opcional: escreva uma mensagem fictícia, que vira uma conversa de teste ligada ao pedido da conversa escolhida."
      >
        Rode o agente
      </Titulo>
      <form onSubmit={enviar} className="space-y-4 rounded-3xl bg-creme p-4 sm:p-6">
        <label className="block space-y-1">
          <span className="font-semibold text-azul">Conversa da fila</span>
          <select value={id} onChange={(e) => setId(e.target.value)} className={campo}>
            {conversas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} · {CANAL[c.canal] ?? c.canal} · {c.marca} · gravado: {MOTIVO[c.motivo] ?? c.motivo}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="font-semibold text-azul">Mensagem fictícia (opcional)</span>
          <textarea value={mensagem} onChange={(e) => setMensagem(e.target.value.slice(0, LIMITE))} rows={3} maxLength={LIMITE} className={campo} placeholder="Deixe em branco para processar as mensagens da própria conversa." />
          <span className="text-xs text-tinta-suave">
            {mensagem.length.toLocaleString("pt-BR")} / {LIMITE.toLocaleString("pt-BR")} caracteres. Não escreva dados reais: CPF, telefone, e-mail e cartão são mascarados antes do modelo, mas a mensagem deve ser inventada.
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          {EXEMPLOS.map((e) => (
            <button key={e} type="button" onClick={() => setMensagem(e)} className="rounded-full border border-azul bg-white px-3 py-1 text-sm text-azul hover:bg-limao hover:text-azul-escuro">
              {e.length > 48 ? `${e.slice(0, 46)}…` : e}
            </button>
          ))}
        </div>
        <button type="submit" disabled={estado.tipo === "carregando"} className="rounded-full bg-azul px-6 py-3 font-semibold text-white hover:bg-azul-escuro focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ciano disabled:opacity-60">
          {estado.tipo === "carregando" ? "Processando… (até ~15 s)" : "Rodar o agente"}
        </button>
        <p className="text-xs text-tinta-suave [overflow-wrap:anywhere]">A chave do AI Proxy fica só no servidor. Limites: 10 requisições por minuto e 100 por dia por IP, 300 por dia no total.</p>
      </form>

      <div aria-live="polite">
        {estado.tipo === "erro" ? <p className="rounded-xl border-2 border-nivel-2 bg-nivel-2-claro p-4 text-tinta">{estado.texto}</p> : null}
        {estado.tipo === "ok" ? (
          <section className="space-y-3">
            <p className="text-sm text-tinta-suave">
              Respondido em {(estado.ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s{estado.teste ? " · conversa de teste com a mensagem fictícia; a ficha é a do pedido escolhido" : ""}.
            </p>
            <FichaCaso caso={estado.caso} ficha={fichas[estado.id] ?? []} aviso={estado.aviso} />
          </section>
        ) : null}
      </div>
    </div>
  );
}
