import type { DadosPainel } from "@/lib/painel/dados";
import { Cartao, Fonte, MOTIVO, pct, Subtitulo, Tabela, TD, TH, Titulo } from "./ui";

export function Conferencia({ c, fila }: { c: DadosPainel["conferencia"]; fila: DadosPainel["fila"]["sumario"] }) {
  const j = c.jev;
  const rv = j.revisao;
  return (
    <div className="space-y-8">
      <Titulo etiqueta="Como conferimos a IA" sub="O que medimos, onde a IA errou (ou pareceu errar) e o que mudou por causa disso.">
        Conferência
      </Titulo>

      <section className="space-y-3">
        <Subtitulo>Avaliação do Jev contra a tag do atendente</Subtitulo>
        <div className="grid gap-3 md:grid-cols-3">
          <Cartao>
            <p className="text-3xl font-extrabold">{pct(j.concordancia * 100)}</p>
            <p className="text-sm text-tinta">de concordância com a tag humana na amostra estratificada de {j.n}. Mede o ruído da tag, não a acurácia do Jev.</p>
          </Cartao>
          <Cartao>
            <p className="text-3xl font-extrabold">{pct(rv.acuraciaMinima * 100, 0)}</p>
            <p className="text-sm text-tinta">
              de acurácia mínima: {rv.concordancias} concordâncias + {rv.jevCerto} desencontros revisados à mão com o Jev certo, em {j.n}. Faltam revisar {rv.naoRevisados}.
            </p>
          </Cartao>
          <Cartao>
            <p className="text-3xl font-extrabold">{rv.jevCerto} de {rv.revisados}</p>
            <p className="text-sm text-tinta">desencontros de maior confiança em que o Jev acertou (revisão manual de Mauro, com apoio de IA, lendo mensagens e status do pedido).</p>
          </Cartao>
        </div>
        <div className="rounded-2xl border-2 border-nivel-2 bg-nivel-2-claro p-4 text-tinta">
          <p className="font-semibold">Achado de segurança: AT107397</p>
          <p className="mt-1 text-sm">{rv.observacoes.find((o) => o.conversation_id === "AT107397")?.texto}. O Jev classifica como reação adversa (confiança 1,0), o que leva o caso ao nível 2 com orientação de suspensão e registro em 24 h.</p>
        </div>
        <p className="text-sm text-tinta">
          Também revisado: AT114627 tem {rv.observacoes.find((o) => o.conversation_id === "AT114627")?.texto}. Confiança dos desencontros: {j.confiancaDiscordantes[">=0,9"]} de {Object.values(j.confiancaDiscordantes).reduce((a, b) => a + b, 0)} com confiança ≥ 0,9; na revisão, a confiança alta acompanhou acerto. A segurança continua nas regras do motor: fatos de sistema, evidências e limites, não a confiança do modelo.
        </p>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Tabela legenda="Concordância por tag">
            <thead>
              <tr>
                <th className={TH}>Tag do atendente</th>
                <th className={TH}>n</th>
                <th className={TH}>Concordância</th>
              </tr>
            </thead>
            <tbody>
              {j.porTag.map((t) => (
                <tr key={t.tag}>
                  <td className={TD}>{t.tag}</td>
                  <td className={`${TD} tabular-nums`}>{t.n}</td>
                  <td className={`${TD} tabular-nums`}>{pct(t.concordancia * 100)}</td>
                </tr>
              ))}
            </tbody>
          </Tabela>
          <Tabela legenda="Desencontros revisados">
            <thead>
              <tr>
                <th className={TH}>Conversa</th>
                <th className={TH}>Tag</th>
                <th className={TH}>Jev</th>
                <th className={TH}>Revisão</th>
              </tr>
            </thead>
            <tbody>
              {j.desencontros.map((d) => (
                <tr key={d.conversation_id}>
                  <td className={`${TD} font-medium text-azul`}>{d.conversation_id}</td>
                  <td className={TD}>{d.tag}</td>
                  <td className={TD}>{MOTIVO[d.motivo_jev] ?? d.motivo_jev} ({d.confianca.toLocaleString("pt-BR")})</td>
                  <td className={TD}>{d.conversation_id === "AT107397" ? "Jev certo · reação adversa" : d.conversation_id === "AT114627" ? "Jev certo · dois motivos" : "Jev certo"}</td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </div>
      </section>

      <section className="space-y-3">
        <Subtitulo>Os 9 anexos com &quot;produto da foto diferente do pedido&quot;, conferidos à mão</Subtitulo>
        <p className="text-sm text-tinta">
          O verificador compara a descrição visual da foto com o pedido (etiqueta, nome do catálogo, categoria, estampa × personalização). Todos os {c.anexos.length} também têm a mesma foto em outro pedido ou cliente, e {c.anexos.filter((a) => a.outros_sinais_fortes.includes("EXIF antes da entrega")).length} têm EXIF anterior à entrega: nenhum depende só da comparação de produto. Pontos frágeis anotados na conferência: &quot;copo × garrafa&quot; depende de a descrição distinguir os dois; &quot;estampa × personalização&quot; supõe que nome e iniciais não aparecem como estampa.
        </p>
        <Tabela legenda="Anexos conferidos">
          <thead>
            <tr>
              <th className={TH}>Anexo</th>
              <th className={TH}>Conversa</th>
              <th className={TH}>Descrição da foto</th>
              <th className={TH}>Produto do pedido</th>
              <th className={TH}>Regra</th>
              <th className={TH}>Outros sinais fortes</th>
            </tr>
          </thead>
          <tbody>
            {c.anexos.map((a) => (
              <tr key={a.anexo_id}>
                <td className={`${TD} font-medium text-azul`}>{a.anexo_id}</td>
                <td className={TD}>{a.conversation_id}</td>
                <td className={`${TD} max-w-xs whitespace-normal`}>{a.descricao_visual}</td>
                <td className={`${TD} max-w-xs whitespace-normal`}>{a.produto_do_pedido}</td>
                <td className={`${TD} max-w-xs whitespace-normal`}>{a.regra}</td>
                <td className={TD}>{a.outros_sinais_fortes.join("; ")}</td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Cartao>
          <Subtitulo>Vazamento de informação do futuro</Subtitulo>
          <p className="mt-2 text-sm text-tinta">
            A primeira simulação lia a posição de 02/11 (status &quot;estornada&quot; do gateway, pedido entregue, CRM) para decidir conversas de agosto: cobranças estornadas depois pareciam já estornadas na conversa. Corrigido montando a ficha na data da conversa (pedido, eventos, cobranças, estornos e chamados até aquele momento; reenvios contados no OMS).
          </p>
        </Cartao>
        <Cartao>
          <Subtitulo>Prazo de 7 dias contado errado</Subtitulo>
          <p className="mt-2 text-sm text-tinta">
            Os dias desde o recebimento eram contados até a resposta, não até a reclamação: uma conversa aberta no prazo e parada na fila seria negada. Corrigido para contar até a abertura da conversa; a simulação foi refeita.
          </p>
        </Cartao>
        <Cartao>
          <Subtitulo>HTTP 429 do AI Proxy</Subtitulo>
          <p className="mt-2 text-sm text-tinta">
            Com 5 chamadas simultâneas o proxy recusou por limite: {j.falhas429} de {j.chamadas} chamadas na avaliação, todas recuperadas ({j.invalidas} inválidas no fim). Agora: nova tentativa depois de 1,5 s no Jev e na redação, no máximo 2 conversas ao mesmo tempo na rota e, se ainda falhar, o resultado gravado com aviso na tela.
          </p>
        </Cartao>
        <Cartao>
          <Subtitulo>Checagem do texto gerado</Subtitulo>
          <p className="mt-2 text-sm text-tinta">
            Toda resposta passa por uma checagem em código antes de sair: número, data ou valor que não está na ficha, acusação, lei sem fonte, promessa que a ação não cumpre, ação dada como feita sem ter sido, link e dado pessoal. Na fila: {fila.redacao_aprovada_na_2a_tentativa} redações aprovadas na 2ª tentativa e {fila.texto_de_reserva} que caiu no texto de reserva e foi para aprovação. Caso sinalizado nem passa pelo modelo: a mensagem é fixa (&quot;em análise&quot;).
          </p>
        </Cartao>
      </section>
      <Fonte>{c.fonte}; revisão manual registrada em docs/decisoes.md, seção 6.</Fonte>
    </div>
  );
}
