import type { DadosPainel } from "@/lib/painel/dados";
import { Cartao, Fonte, pct, Subtitulo, Titulo } from "./ui";

const FLUXO = [
  ["Conversa", "WhatsApp, e-mail ou Reclame Aqui; CPF, cartão, telefone e e-mail mascarados"],
  ["Ficha única", "ERP, portal da transportadora, gateway, OMS, CRM e anexos, com a origem de cada campo"],
  ["Jev", "classifica o motivo, a urgência e seis sinais do texto; não decide nada"],
  ["Evidências", "hash repetido, EXIF, produto da foto, prazo e histórico de reenvios"],
  ["Política", "código determinístico decide o nível 0, 1 ou 2 e a ação, citando a regra"],
  ["Ferramentas", "26 ferramentas simuladas com papel, limite e log"],
  ["Resposta checada", "o modelo redige; a checagem barra número sem fonte, acusação, promessa e dado pessoal"],
] as const;

export function VisaoGeral({ v }: { v: DadosPainel["visao"] }) {
  const r = v.resultado;
  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <Titulo etiqueta="O problema" sub="Histórico de 04/08 a 01/11/2026, amostra de 1 em 4 clientes escalada × 4.">
          O atendimento em 4 números
        </Titulo>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {v.problema.map((p) => (
            <li key={p.rotulo}>
              <Cartao className="h-full">
                <p className="text-3xl font-extrabold tabular-nums">{p.valor}</p>
                <p className="mt-1 font-semibold">{p.rotulo}</p>
                <p className="mt-1 text-sm text-tinta-suave">{p.detalhe}</p>
              </Cartao>
            </li>
          ))}
        </ul>
        <Fonte>{v.problema[0].fonte}</Fonte>
      </section>

      <section className="space-y-4">
        <Titulo etiqueta="O resultado" sub="As 2.984 conversas do histórico passadas pelo motor real, política vigente × nova política (o padrão do agente).">
          Quanto se resolve sem pessoa
        </Titulo>
        <div className="grid gap-3 lg:grid-cols-2">
          <Cartao>
            <p className="font-semibold">conversas sem nenhuma pessoa</p>
            <p className="mt-1 text-4xl font-extrabold tabular-nums">
              {pct(r.semPessoa.vigente)} <span aria-label="para">→</span> {pct(r.semPessoa.nova)}
            </p>
            <p className="mt-2 text-sm text-tinta">
              Ação no nível 0 e resposta enviada sem aprovação: ninguém toca na conversa. Sem contar as {r.semPessoa.semDemanda} conversas em que o cliente não escreveu nada (o bot já as encerrava). Com elas no denominador: {pct(r.semPessoa.vigenteTodas)} → {pct(r.semPessoa.novaTodas)}.
            </p>
          </Cartao>
          <Cartao>
            <p className="font-semibold">ações executadas sozinho</p>
            <p className="mt-1 text-4xl font-extrabold tabular-nums">
              {pct(r.sozinho.vigente)} <span aria-label="para">→</span> {pct(r.sozinho.nova)}
            </p>
            <p className="mt-2 text-sm text-tinta">
              A ação (reenvio, estorno, chamado, cancelamento) sai sem esperar ninguém. A diferença para a métrica ao lado é a <strong>resposta pública do Reclame Aqui</strong>: a ação sai sozinha, mas uma pessoa aprova o texto público, então a conversa não conta como sem nenhuma pessoa.
            </p>
          </Cartao>
          <Cartao>
            <p className="font-semibold">horas liberadas por mês</p>
            <p className="mt-1 text-4xl font-extrabold tabular-nums">
              {r.horas.vigente.toLocaleString("pt-BR")} → {r.horas.nova.toLocaleString("pt-BR")}
            </p>
            <p className="mt-2 text-sm text-tinta">Minutos medidos por conversa (tempo_por_conversa) das conversas sem nenhuma pessoa. Conversa sem demanda conta zero hora.</p>
          </Cartao>
          <Cartao>
            <p className="font-semibold">casos com sinal forte sinalizados ao supervisor</p>
            <p className="mt-1 text-4xl font-extrabold tabular-nums">{r.sinalizadosMes} por mês</p>
            <p className="mt-2 text-sm text-tinta">
              {r.sinalizadosAmostra} na amostra: foto repetida de outro pedido ou cliente, EXIF anterior à entrega ou produto da foto diferente. O cliente recebe só &quot;em análise&quot;; o agente nunca nega por suspeita.
            </p>
          </Cartao>
        </div>
        <Fonte>{r.fonte}</Fonte>
      </section>

      <section className="space-y-4">
        <Titulo etiqueta="Como funciona" sub="O modelo entende e redige; o código decide. Cada passo deixa registro.">
          Fluxo de uma conversa
        </Titulo>
        <ol className="flex flex-wrap items-stretch gap-2" aria-label="Fluxo do agente">
          {FLUXO.map(([nome, texto], i) => (
            <li key={nome} className="flex items-stretch gap-2">
              <div className={`w-40 rounded-2xl p-3 ${nome === "Jev" || nome === "Resposta checada" ? "bg-ciano text-azul-escuro" : nome === "Política" ? "bg-azul text-white" : "bg-creme text-azul"}`}>
                <p className="font-extrabold">{nome}</p>
                <p className={`mt-1 text-xs ${nome === "Política" ? "text-white" : "text-tinta"}`}>{texto}</p>
              </div>
              {i < FLUXO.length - 1 ? (
                <span aria-hidden="true" className="self-center text-xl font-extrabold text-azul">
                  →
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        <p className="text-sm text-tinta-suave">
          <span aria-hidden="true" className="mr-1 inline-block h-3 w-3 rounded-sm bg-ciano align-middle" />
          Em ciano: onde entra o modelo (Jev para classificar, chat completions para redigir). Em azul: a decisão, sempre do código.
        </p>
        <Subtitulo>Níveis</Subtitulo>
        <ul className="grid gap-2 text-sm sm:grid-cols-3">
          <li className="rounded-xl border-l-8 border-nivel-0 bg-creme p-3 text-tinta"><strong className="text-azul">Nível 0</strong> · o agente resolve e responde.</li>
          <li className="rounded-xl border-l-8 border-nivel-1 bg-creme p-3 text-tinta"><strong className="text-azul">Nível 1</strong> · o agente prepara, uma pessoa aprova.</li>
          <li className="rounded-xl border-l-8 border-nivel-2 bg-creme p-3 text-tinta"><strong className="text-azul">Nível 2</strong> · pessoa obrigatória (suspeita, reação adversa, falha).</li>
        </ul>
      </section>
    </div>
  );
}
