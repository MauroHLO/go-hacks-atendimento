// Ficha do caso: classificação do Jev, ficha única com a origem de cada campo, sinais de evidência, decisão
// do motor com a regra citada, linha do tempo das ferramentas e a resposta (enviada ou rascunho).
// Mesmo formato para a fila, os casos do histórico e o teste ao vivo (lib/agent/resumo.ts).

import type { Resumo } from "@/lib/agent/resumo";
import type { LinhaFicha } from "@/lib/painel/dados";
import { CANAL, CLARO_NIVEL, COR_NIVEL, MOTIVO, NivelChip, NOME_NIVEL, nomeFerramenta, Tabela, TD, TH, type Nivel } from "./ui";

const NOUL: Record<string, string> = {
  reacao_adversa: "reação adversa",
  mencao_saude: "menção de saúde",
  ameaca_reclame_aqui_ou_procon: "ameaça de Reclame Aqui ou Procon",
  cliente_irritado: "cliente irritado",
  pede_ou_envia_dado_sensivel: "pede ou envia dado sensível",
  mais_de_um_motivo: "mais de um motivo",
};

const FALHA_CHECAGEM: Record<string, string> = {
  numero_sem_fonte: "número sem fonte",
  numero_por_extenso: "número por extenso",
  dado_sensivel: "dado pessoal",
  link_sem_fonte: "link sem fonte",
  acusacao: "tom de acusação",
  politica_sem_fonte: "lei ou política sem fonte",
  termo_de_solucao: "solução que a ação não faz",
  promessa_contato: "promessa de contato",
  compromisso: "compromisso sem ação",
  acao_feita: "ação dada como feita sem ter sido",
  formato: "formato",
};

function Barra({ valor }: { valor: number }) {
  return (
    <span className="inline-block h-2 w-24 overflow-hidden rounded-full bg-zinc-200 align-middle" aria-hidden="true">
      <span className="block h-full rounded-full bg-azul" style={{ width: `${Math.round(valor * 100)}%` }} />
    </span>
  );
}

// Justificativa com as citações [fonte] destacadas.
function Justificativa({ texto }: { texto: string }) {
  const partes = texto.split(/(\[[^\]]+\])/g);
  return (
    <p className="text-sm leading-relaxed text-tinta">
      {partes.map((p, i) =>
        p.startsWith("[") ? (
          <span key={i} className="mx-0.5 rounded bg-white px-1 font-mono text-xs text-azul-escuro ring-1 ring-zinc-300">
            {p.slice(1, -1)}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}

// Seção da ficha em acordeão.
function Secao({ titulo, aberto = false, children }: { titulo: string; aberto?: boolean; children: React.ReactNode }) {
  return (
    <details open={aberto} className="group rounded-2xl border border-zinc-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-3 text-lg font-semibold text-azul hover:bg-creme focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ciano [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block text-base transition-transform group-open:rotate-90">▸</span>
        {titulo}
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

export function FichaCaso({ caso, ficha, aviso }: { caso: Resumo; ficha: LinhaFicha[]; aviso?: string | null }) {
  const c = caso.classificacao;
  const d = caso.decisao;
  const nivel = d.nivel_final as Nivel;
  const probs = Object.entries(c.probabilidades ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const noul = Object.entries(c.sinais_texto ?? {});
  const recusas = caso.acoes.filter((a) => !a.ok);
  const semDemanda = c.motivo === "sem_demanda";

  return (
    <div className="space-y-5">
      {aviso ? (
        <p role="status" className="rounded-xl border-2 border-nivel-1 bg-nivel-1-claro px-4 py-3 text-sm font-medium text-tinta">
          {aviso}
        </p>
      ) : null}

      <div className={`rounded-[1.5rem] p-5 sm:p-6 ${CLARO_NIVEL[nivel]}`}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <span className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-3xl font-extrabold ${COR_NIVEL[nivel]}`} aria-hidden="true">
            {nivel}
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-tinta">
              <span className="font-semibold text-azul">{caso.conversation_id}</span> · {CANAL[caso.canal] ?? caso.canal}
            </p>
            <p className="text-2xl font-extrabold text-azul">
              Nível {nivel} · {NOME_NIVEL[nivel]}
            </p>
            <p className="text-tinta">
              Ação: <strong className="font-semibold">{nomeFerramenta(d.ferramenta)}</strong> · Motivo: <strong className="font-semibold">{MOTIVO[c.motivo] ?? c.motivo}</strong>
              {c.valida && !semDemanda ? <span className="text-tinta-suave"> (confiança {c.confianca.toLocaleString("pt-BR", { maximumFractionDigits: 2 })})</span> : null}
            </p>
            {d.nivel !== d.nivel_final ? <p className="text-sm text-tinta-suave">O motor decidiu nível {d.nivel}; subiu na execução.</p> : null}
          </div>
        </div>
      </div>

      <Secao titulo="1. Classificação (Jev)">
          {semDemanda ? (
            <p className="mt-2 text-sm text-tinta">O cliente não escreveu nada (só o bot falou): sem demanda, sem chamar o modelo.</p>
          ) : !c.valida ? (
            <p className="mt-2 text-sm text-tinta">Classificação indisponível ({c.falha}): uma pessoa assume o caso.</p>
          ) : (
            <div className="mt-2 space-y-3 text-sm text-tinta">
              <p>
                Motivo: <strong className="font-semibold text-azul">{MOTIVO[c.motivo] ?? c.motivo}</strong> · confiança {c.confianca.toLocaleString("pt-BR")}
                {c.motivo_jev && c.motivo_jev !== c.motivo ? <span className="text-tinta-suave"> (Jev escolheu {c.motivo_jev}; regra do código prevaleceu)</span> : null}
                {c.urgencia ? <> · urgência {c.urgencia}</> : null}
              </p>
              {probs.length ? (
                <ul className="space-y-1" aria-label="Probabilidades do motivo">
                  {probs.map(([m, p]) => (
                    <li key={m} className="flex items-center gap-2">
                      <Barra valor={p} />
                      <span className="w-12 tabular-nums">{p.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}</span>
                      <span>{MOTIVO[m] ?? m}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {noul.length ? (
                <div>
                  <p className="font-medium text-azul">Sinais do texto (sim/não, probabilidade de sim)</p>
                  <ul className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                    {noul.map(([k, v]) => (
                      <li key={k} className={v >= 0.5 ? "font-semibold" : "text-tinta-suave"}>
                        {NOUL[k] ?? k}: {v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                        {v >= 0.5 ? " · sim" : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
      </Secao>

      <Secao titulo="2. Decisão do motor de política">
          <div className="mt-2 space-y-2 text-sm text-tinta">
            <p>
              <NivelChip nivel={d.nivel as Nivel} /> · {nomeFerramenta(d.acao)}
            </p>
            <Justificativa texto={d.justificativa} />
            <ul className="space-y-0.5 text-tinta-suave">
              {d.aprovacao_resposta ? <li>Resposta pública do Reclame Aqui: uma pessoa aprova o texto.</li> : null}
              {d.acao_sem_teto ? <li>Direito comprovado por sistema: sem teto em R$, até o valor do pedido.</li> : null}
              {d.auditoria_posterior ? <li>Sorteado para auditoria posterior (10% do nível 0).</li> : null}
              {d.ajustes.map((a) => (
                <li key={a}>Ajuste: {a}</li>
              ))}
            </ul>
          </div>
      </Secao>

      <Secao titulo="3. Ficha única">
        <p className="mb-2 text-sm text-tinta-suave">Cada campo com o sistema de onde veio (em vez de abrir cada portal).</p>
        <Tabela legenda="Ficha única com a origem de cada campo">
          <thead>
            <tr>
              <th className={TH}>Campo</th>
              <th className={TH}>Valor</th>
              <th className={TH}>Origem</th>
            </tr>
          </thead>
          <tbody>
            {ficha.map((l) => (
              <tr key={l.campo}>
                <td className={`${TD} font-medium text-azul`}>{l.campo}</td>
                <td className={`${TD} max-w-md whitespace-normal`}>{l.valor}</td>
                <td className={`${TD} text-tinta-suave`}>{l.origem}</td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      </Secao>

      <Secao titulo="4. Sinais de evidência">
        {caso.sinais.length === 0 ? (
          <p className="text-sm text-tinta-suave">Nenhum sinal{caso.sinais.length === 0 && ["avaria", "item_faltante", "brinde", "erro_personalizacao"].includes(c.motivo) ? " nas fotos e no histórico do cliente" : " (o motivo não depende de foto)"}.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {caso.sinais.map((s, i) => (
              <li key={i} className="flex flex-wrap gap-x-2">
                <span className={`rounded-full px-2 text-xs font-semibold ${s.tipo === "forte" ? "bg-nivel-2-claro text-tinta" : "bg-zinc-100 text-tinta"}`}>{s.tipo}</span>
                <span className="font-medium">{s.sinal.replaceAll("_", " ")}</span>
                {"evidencia" in s && s.evidencia ? <span className="text-tinta-suave">{String(s.evidencia)}</span> : s.anexo ? <span className="text-tinta-suave">anexo {s.anexo}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao titulo="5. Linha do tempo das ferramentas" aberto>
        <p className="mb-2 text-sm text-tinta-suave [overflow-wrap:anywhere]">Log no formato de acoes_executadas_sistemas; ações simuladas, executado_por = agente.</p>
        <ol className="relative space-y-0 border-l-2 border-ciano pl-4">
          {caso.log.map((l) => (
            <li key={l.acao_id} className="relative py-1.5 text-sm">
              <span aria-hidden="true" className="absolute -left-[1.4rem] top-3 h-2.5 w-2.5 rounded-full bg-azul" />
              <span className="font-semibold text-azul">{nomeFerramenta(l.acao)}</span>
              <span className="text-tinta-suave"> · {l.sistema}</span>
              {l.valor_rs !== null && l.valor_rs !== undefined ? <span> · R$ {Number(l.valor_rs).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span> : null}
              {l.referencia_sistema ? <span className="text-tinta-suave"> · {l.referencia_sistema}</span> : <span className="text-tinta-suave"> · ok</span>}
            </li>
          ))}
          {recusas.map((a, i) => (
            <li key={`r${i}`} className="relative py-1.5 text-sm">
              <span aria-hidden="true" className="absolute -left-[1.4rem] top-3 h-2.5 w-2.5 rounded-full bg-nivel-2" />
              <span className="font-semibold text-tinta">{nomeFerramenta(a.ferramenta)}</span>
              <span className="text-tinta-suave"> · recusada: {a.erro}</span>
            </li>
          ))}
        </ol>
      </Secao>

      <Secao titulo="6. Resposta" aberto>
        {semDemanda ? (
          <p className="text-sm text-tinta-suave">Sem resposta: não há o que responder. A conversa é encerrada.</p>
        ) : (
          <div className={`mt-1 rounded-2xl border-2 p-4 ${caso.resposta.enviada ? "border-azul bg-white" : "border-dashed border-nivel-1 bg-nivel-1-claro"}`}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-tinta-suave">
              {caso.resposta.enviada ? "Enviada ao cliente (checada)" : "Rascunho aguardando aprovação"}
              {caso.resposta.reserva ? " · texto de reserva" : ""}
              {caso.resposta.tentativas > 1 ? ` · aprovada na ${caso.resposta.tentativas}ª redação` : ""}
            </p>
            <p className="whitespace-pre-line text-tinta">{caso.resposta.texto}</p>
            {caso.resposta.falhasChecagem.length ? (
              <p className="mt-2 text-xs text-tinta-suave">
                Recusas da checagem: {caso.resposta.falhasChecagem.map((f, i) => `${i + 1}ª: ${f.map((x) => FALHA_CHECAGEM[x] ?? x).join(", ")}`).join("; ")}
              </p>
            ) : null}
          </div>
        )}
      </Secao>

      <p className="text-xs text-tinta-suave">
        {caso.telemetria.sistemasAcessados} sistemas consultados · {(caso.telemetria.ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s · Jev {caso.telemetria.jev.tokensEntrada + caso.telemetria.jev.tokensSaida} tokens · redação {caso.telemetria.chat.tokensEntrada + caso.telemetria.chat.tokensSaida} tokens
      </p>
    </div>
  );
}
