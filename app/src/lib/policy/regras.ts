// Constantes da política de atendimento. Cada valor vem de data/raw/atendimento/politicas.csv,
// ferramentas.csv ou parametros.md (versão 2026-11-02); a origem está no comentário de cada um.
// Nenhuma regra é inventada aqui: o que não está nessas fontes está marcado como HIPÓTESE ou como
// decisão do time em docs/decisoes.md.

// ---------------------------------------------------------------------------
// Confiança do classificador
// ---------------------------------------------------------------------------
// CLAUDE.md (regras): "Confiança do Jev abaixo de 0,7 eleva o caso para nível 1."
export const LIMIAR_CONFIANCA = 0.7;

// ---------------------------------------------------------------------------
// Limites por papel
// ---------------------------------------------------------------------------
// politicas.csv › limites_por_papel › atendente.reenvio_ou_reimpressao_max_rs = 200.0
// ferramentas.csv › reenviar_produto, reimprimir_personalizacao › valor_max_sem_aprovacao_rs = 200.0
export const LIMITE_ATENDENTE_REENVIO_RS = 200;
// politicas.csv › limites_por_papel › atendente.troca_max_rs = 200.0
// ferramentas.csv › trocar_produto › valor_max_sem_aprovacao_rs = 200.0
export const LIMITE_ATENDENTE_TROCA_RS = 200;
// politicas.csv › limites_por_papel › atendente.reembolso_max_rs = 100.0
// ferramentas.csv › reembolsar › valor_max_sem_aprovacao_rs = 100.0
export const LIMITE_ATENDENTE_REEMBOLSO_RS = 100;
// politicas.csv › limites_por_papel › analista.notificacoes_proativas_por_dia = 300
export const MAX_NOTIFICACOES_DIA = 300;

// ---------------------------------------------------------------------------
// Prazos por categoria
// ---------------------------------------------------------------------------
// politicas.csv › categorias › onde_esta_pedido.regra: "Rastreio parado há 3 dias úteis ou mais: abrir chamado"
export const RASTREIO_PARADO_DIAS_UTEIS = 3;
// politicas.csv › categorias › atraso_entrega.limite_dias_uteis_para_reenvio = 7
export const ATRASO_LIMITE_DIAS_UTEIS = 7;
// politicas.csv › categorias › item_faltante | avaria_vazamento | erro_personalizacao
//   .prazo_dias_corridos_do_recebimento = 7
export const PRAZO_RECLAMACAO_DIAS = 7;
// politicas.csv › categorias › arrependimento_cancelamento.prazo_dias_corridos_do_recebimento = 7
export const PRAZO_ARREPENDIMENTO_DIAS = 7;
// politicas.csv › categorias › troca_fragrancia.prazo_dias_corridos_do_recebimento = 30
export const PRAZO_TROCA_FRAGRANCIA_DIAS = 30;
// politicas.csv › categorias › troca_fragrancia.max_trocas_por_pedido = 1
export const MAX_TROCAS_FRAGRANCIA_POR_PEDIDO = 1;
// politicas.csv › categorias › troca_fragrancia.max_produto_usado_pct = 20
export const MAX_USO_FRAGRANCIA_PCT = 20;
// politicas.csv › categorias › reacao_adversa.prazo_registro_horas = 24
export const PRAZO_COSMETOVIGILANCIA_HORAS = 24;
// politicas.csv › reclamacao_suspeita › prazo_decisao_horas = 24
export const PRAZO_DECISAO_SUSPEITA_HORAS = 24;

// ---------------------------------------------------------------------------
// Reclamações que não procedem (parametros.md, seção de mesmo nome)
// ---------------------------------------------------------------------------
// "Reenviar ou reembolsar uma reclamação que não procede: valor do pedido x 45%"
export const FATOR_CUSTO_IMPROCEDENTE = 0.45;
// "Sinalizar para o supervisor uma reclamação verdadeira: R$ 6 (tempo do supervisor)"
export const CUSTO_SINALIZAR_RS = 6;
// HIPÓTESE do time (não está nas fontes): probabilidade inicial de a reclamação não proceder,
// dado o conjunto de sinais. Revisar com os dados rotulados de anexos (analysis/).
export const PROB_IMPROCEDENTE = {
  nenhumSinal: 0.05,
  umFraco: 0.15,
  doisOuMaisFracos: 0.3,
  algumForte: 0.9,
} as const;
// Mensagem neutra ao cliente quando o caso é sinalizado.
// politicas.csv › reclamacao_suspeita › comunicacao_com_cliente: "nunca acusar o cliente de fraude;
// enquanto o caso está em análise, informar apenas que a solicitação está em análise"
export const MENSAGEM_EM_ANALISE =
  "Recebemos sua solicitação e ela está em análise. Retornamos em até 24 horas com a solução.";

// ---------------------------------------------------------------------------
// Calendário (parametros.md › Prazo de entrega; politicas.csv › prazos_entrega)
// ---------------------------------------------------------------------------
// politicas.csv › prazos_entrega › feriados_nacionais
export const FERIADOS_NACIONAIS: readonly string[] = [
  "2026-09-07",
  "2026-10-12",
  "2026-11-02",
  "2026-11-15",
  "2026-11-20",
  "2026-12-25",
  "2027-01-01",
];

// Dias úteis de `inicio` (exclusive) até `fim` (inclusive), sem sábados, domingos e feriados.
// Datas em "AAAA-MM-DD". Se fim <= inicio, devolve 0.
export function diasUteisEntre(inicio: string, fim: string, feriados: readonly string[] = FERIADOS_NACIONAIS): number {
  const umDia = 86_400_000;
  const a = Date.parse(`${inicio}T00:00:00Z`);
  const b = Date.parse(`${fim}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new RangeError(`data inválida: ${inicio} / ${fim}`);
  const fer = new Set(feriados);
  let n = 0;
  for (let t = a + umDia; t <= b; t += umDia) {
    const d = new Date(t);
    const semana = d.getUTCDay();
    if (semana !== 0 && semana !== 6 && !fer.has(d.toISOString().slice(0, 10))) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Texto das regras, para citar na justificativa
// ---------------------------------------------------------------------------
export interface Regra {
  origem: string;
  texto: string;
}

export const REGRAS = {
  rastreio: {
    origem: "politicas.csv › categorias › onde_esta_pedido.regra",
    texto: "Dentro do prazo, informar status e previsão. Rastreio parado há 3 dias úteis ou mais: abrir chamado com a transportadora.",
  },
  atraso: {
    origem: "politicas.csv › categorias › atraso_entrega.regra",
    texto: "Atraso de até 7 dias úteis: abrir chamado. Acima de 7 dias úteis ou extravio confirmado: reenviar ou reembolsar, à escolha do cliente.",
  },
  item_faltante: {
    origem: "politicas.csv › categorias › item_faltante.regra",
    texto: "Reenvio sem custo do item faltante (inclusive brinde de campanha), mediante foto, em até 7 dias do recebimento.",
  },
  avaria: {
    origem: "politicas.csv › categorias › avaria_vazamento.regra",
    texto: "Reenvio sem custo mediante foto em até 7 dias do recebimento.",
  },
  erro_personalizacao: {
    origem: "politicas.csv › categorias › erro_personalizacao.regra",
    texto: "Gocase: nome, foto ou iniciais diferentes do pedido, impressão borrada, torta ou descascando: nova produção sem custo, mediante foto, em até 7 dias do recebimento.",
  },
  suspeita: {
    origem: "politicas.csv › reclamacao_suspeita",
    texto: "Atendente e analista podem sinalizar (sinalizar_suspeita) com evidências verificáveis; nunca negam sozinhos por suspeita. Quem decide é o supervisor.",
  },
  custo_erro: {
    origem: "parametros.md › Reclamações que não procedem",
    texto: "Reenviar uma reclamação que não procede custa valor do pedido x 45%; sinalizar uma verdadeira custa R$ 6.",
  },
  cobranca_duplicada: {
    origem: "politicas.csv › categorias › cobranca_duplicada.regra",
    texto: "Estorno da duplicidade em até 2 faturas (cartão) ou 5 dias úteis (pix). Reembolso acima de R$ 100 exige aprovação do supervisor.",
  },
  endereco: {
    origem: "politicas.csv › categorias › alteracao_endereco.regra",
    texto: "Possível somente antes da separação do pedido.",
  },
  cancelamento: {
    origem: "politicas.csv › categorias › arrependimento_cancelamento.regra",
    texto: "Antes da separação: cancelar o pedido (estorno integral, sem limite de valor). Depois do recebimento: reembolso integral em até 7 dias (CDC, art. 49), com coleta reversa. Fora do prazo: negar explicando a política.",
  },
  troca_fragrancia: {
    origem: "politicas.csv › categorias › troca_fragrancia.regra",
    texto: "1 troca por pedido, em até 30 dias, com no máximo 20% do produto utilizado.",
  },
  duvida_produto: {
    origem: "politicas.csv › categorias › duvida_produto.acoes_permitidas",
    texto: "responder_duvida, com base na ficha do produto (ferramentas.csv › responder_duvida).",
  },
  cupom: {
    origem: "politicas.csv › categorias › cupom_promocao.acoes_permitidas",
    texto: "validar_cupom.",
  },
  reacao_adversa: {
    origem: "politicas.csv › categorias › reacao_adversa.regra",
    texto: "Reação adversa a cosmético ou suplemento: orientar a suspensão do uso e registrar_cosmetovigilancia em até 24 horas. Trocar o produto não substitui o registro.",
  },
  reclame_aqui: {
    origem: "politicas.csv › sla_primeira_resposta › reclame_aqui.resposta_publica",
    texto: "A resposta no Reclame Aqui é pública.",
  },
  confianca: {
    origem: "CLAUDE.md › regras (Jev)",
    texto: "Confiança do Jev abaixo de 0,7 eleva o caso para nível 1.",
  },
  limites: {
    origem: "politicas.csv › limites_por_papel",
    texto: "O atendente reenvia, reimprime e troca até R$ 200 e reembolsa até R$ 100; acima disso, o supervisor aprova.",
  },
  supervisor: {
    origem: "politicas.csv › limites_por_papel › supervisor.nao_aprova_a_propria_acao; ferramentas.csv › decidir_suspeita",
    texto: "O supervisor não aprova a própria ação nem decide suspeita que ele mesmo sinalizou.",
  },
  fora_da_tabela: {
    origem: "docs/decisoes.md › motor de política (motivos fora da tabela)",
    texto: "Motivo ou situação sem regra de autonomia definida: uma pessoa revisa (nível 1).",
  },
  pagamento_pendente: {
    origem: "politicas.csv › categorias › pagamento_pendente.regra",
    texto: "Pix compensa em até 30 minutos; boleto em até 2 dias úteis.",
  },
  elogio: {
    origem: "politicas.csv › categorias › elogio.acoes_permitidas",
    texto: "agradecer.",
  },
} as const satisfies Record<string, Regra>;

export type IdRegra = keyof typeof REGRAS;
