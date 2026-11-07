// Resumo de um ResultadoProcessamento para gravar em data/processed: estrutura, decisão, log e a resposta
// redigida (já checada). Nenhum texto escrito pelo cliente.
import type { ResultadoProcessamento } from "../src/lib/agent/orquestrador";

export function resumo(r: ResultadoProcessamento, opcoes: { evidencias?: boolean } = {}) {
  const c = r.classificacao;
  return {
    conversation_id: r.conversation_id,
    canal: r.ficha.conversa.valor.canal,
    status_fila: r.ficha.conversa.valor.status,
    order_id: r.ficha.conversa.valor.order_id,
    classificacao: {
      valida: c.valida,
      falha: c.falha,
      motivo: c.motivo,
      motivo_jev: c.motivoJev,
      confianca: Math.round(c.confianca * 1000) / 1000,
      urgencia: c.urgencia,
      flags: c.flags,
      mencao_saude: c.mencaoSaude,
    },
    sinais: r.sinais?.detalhes.map((d) => ({ sinal: d.sinal, tipo: d.tipo, anexo: d.anexoId ?? null, ...(opcoes.evidencias ? { evidencia: d.evidencia } : {}) })) ?? [],
    decisao: {
      nivel: r.decisao.nivel,
      nivel_final: r.decisao.nivelFinal,
      aprovacao_resposta: r.decisao.aprovacaoResposta,
      acao: r.decisao.acao,
      ferramenta: r.decisao.ferramenta,
      acao_sem_teto: r.decisao.acaoSemTeto ?? false,
      auditoria_posterior: r.decisao.auditoriaPosterior ?? false,
      justificativa: r.decisao.justificativa,
      ajustes: r.decisao.ajustes,
    },
    acoes: r.acoes,
    log: r.log,
    resposta: r.resposta,
    telemetria: r.telemetria,
  };
}
