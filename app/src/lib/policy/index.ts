// Motor de política do atendimento (docs/decisoes.md, seção 2).
// Função pura e determinística: o LLM classifica e redige; quem decide nível, ação e ferramenta é este código.
// Os valores vêm de ./regras.ts, que cita a origem de cada um.

import {
  ATRASO_LIMITE_DIAS_UTEIS,
  CENARIO_PADRAO,
  CUSTO_SINALIZAR_RS,
  type CenarioPolitica,
  FATOR_CUSTO_IMPROCEDENTE,
  LIMIAR_CONFIANCA,
  LIMITE_ATENDENTE_REEMBOLSO_RS,
  LIMITE_ATENDENTE_REENVIO_RS,
  LIMITE_ATENDENTE_TROCA_RS,
  MAX_TROCAS_FRAGRANCIA_POR_PEDIDO,
  MAX_USO_FRAGRANCIA_PCT,
  MENSAGEM_EM_ANALISE,
  PRAZO_ARREPENDIMENTO_DIAS,
  PRAZO_RECLAMACAO_DIAS,
  PRAZO_TROCA_FRAGRANCIA_DIAS,
  PROB_IMPROCEDENTE,
  RASTREIO_PARADO_DIAS_UTEIS,
  REGRAS,
  type IdRegra,
} from "./regras";

export * from "./regras";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
export type Nivel = 0 | 1 | 2;
export type Canal = "whatsapp" | "email" | "reclame_aqui";
export type Papel = "atendente" | "analista" | "supervisor";

// dicionario_de_dados.md › pedidos.csv › status_entrega
export type StatusEntrega = "aguardando_separacao" | "em_transito" | "entregue" | "extraviado" | "devolvido" | "cancelado";

export const MOTIVOS = [
  "rastreio",
  "atraso",
  "avaria",
  "item_faltante",
  "brinde",
  "erro_personalizacao",
  "cobranca_duplicada",
  "endereco",
  "cancelamento",
  "troca_fragrancia",
  "duvida_produto",
  "cupom",
  "reacao_adversa",
  // Fora da tabela de autonomia (existem em politicas.csv, sem nível definido): nível 1.
  "pagamento_pendente",
  "elogio",
  "sem_interacao",
  "outro",
] as const;
export type Motivo = (typeof MOTIVOS)[number];

// ferramentas.csv (só as que o motor pode indicar)
export type Ferramenta =
  | "informar_status"
  | "abrir_chamado_transportadora"
  | "reenviar_produto"
  | "reimprimir_personalizacao"
  | "trocar_produto"
  | "reembolsar"
  | "cancelar_pedido"
  | "alterar_endereco"
  | "verificar_pagamento"
  | "validar_cupom"
  | "responder_duvida"
  | "orientar_suspensao_uso"
  | "registrar_cosmetovigilancia"
  | "negar_por_politica"
  | "solicitar_foto"
  | "sinalizar_suspeita"
  | "agradecer"
  | "encerrar_conversa";

export const SINAIS_FORTES = [
  "hash_em_outro_pedido_ou_cliente",
  "exif_antes_da_entrega",
  "produto_da_foto_diferente_do_pedido",
] as const;
export const SINAIS_FRACOS = ["software_de_edicao", "cliente_2_ou_mais_reenvios_12m"] as const;
export const SINAIS_ELEGIBILIDADE = ["fora_do_prazo_7_dias", "sem_foto"] as const;
export type SinalForte = (typeof SINAIS_FORTES)[number];
export type SinalFraco = (typeof SINAIS_FRACOS)[number];
export type SinalElegibilidade = (typeof SINAIS_ELEGIBILIDADE)[number];
export type SinalEvidencia = SinalForte | SinalFraco | SinalElegibilidade;

// Fatos do pedido, vindos de lib/contexto. Campo ausente = fato desconhecido: o motor não supõe e
// manda para uma pessoa (nível 1) quando o fato é necessário para decidir.
export interface FatosPedido {
  statusEntrega: StatusEntrega;
  valorPedido: number; // R$, pedidos.valor
  separado?: boolean; // pedidos.data_separacao preenchida
  diasUteisAtraso?: number; // dias úteis além da data prometida (<= 0: dentro do prazo)
  diasUteisSemAtualizacao?: number; // dias úteis desde o último evento de rastreio
  diasDesdeRecebimento?: number; // dias corridos desde pedidos.data_entrega
  temFoto?: boolean; // o cliente já mandou foto nesta conversa
  reenviosCliente12m?: number; // clientes.n_trocas_12m
  duplicidadeConfirmadaGateway?: boolean; // 2+ cobranças efetivadas em pagamentos_gateway
  duplicidadeJaEstornada?: boolean;
  temFichaProduto?: boolean; // há ficha do SKU em produtos.csv
  trocasNoPedido?: number; // trocas_reenvios do pedido com tipo troca
}

export interface EntradaPolitica {
  motivo: Motivo;
  confiancaClassificador: number; // 0 a 1 (Jev)
  fatos: FatosPedido;
  sinais?: readonly SinalEvidencia[];
  valorAcao: number; // R$ da ação proposta (reenvio, reembolso etc.); 0 se não houver dinheiro
  canal: Canal;
  mencaoSaude?: boolean; // o texto do cliente fala de saúde ou reação (lib/agent/sinais)
  cenario?: CenarioPolitica; // padrão: CENARIO_PADRAO
  hashesFotos?: readonly string[]; // hash_perceptual das fotos da conversa (lista de bloqueio)
  gastoAutonomoHojeRs?: number; // R$ já gastos hoje em ações sem teto no nível 0 (freio diário)
  chaveAmostra?: string; // ex.: conversation_id; sorteio determinístico da auditoria
}

export interface DecisaoPolitica {
  nivel: Nivel; // = nivelAcao
  nivelAcao: Nivel; // nível da ação (o que o agente executa)
  aprovacaoResposta: boolean; // a resposta ao cliente precisa de aprovação (Reclame Aqui: resposta pública)
  acaoSemTeto?: boolean; // ação de direito comprovado por sistema executada no nível 0 (conta no freio diário)
  acao: string;
  ferramenta: Ferramenta;
  ferramentasAdicionais?: Ferramenta[]; // alternativa à escolha do cliente ou ação obrigatória junto
  justificativa: string; // cita a regra de origem
  precisaAprovacaoDe?: "supervisor";
  mensagemCliente?: string; // só quando a política fixa o texto (caso sinalizado)
  auditoriaPosterior?: boolean; // nível 0 sorteado para revisão depois de executado
}

// ---------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------
function reais(v: number): string {
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

function cita(id: IdRegra): string {
  return `[${REGRAS[id].origem}]`;
}

interface Parcial {
  nivel: Nivel;
  acao: string;
  ferramenta: Ferramenta;
  ferramentasAdicionais?: Ferramenta[];
  motivos: string[];
  mensagemCliente?: string;
  semTeto?: boolean; // direito comprovado por sistema: sem teto em R$, até o valor do pedido
}

function d(
  nivel: Nivel,
  acao: string,
  ferramenta: Ferramenta,
  explicacao: string,
  regra: IdRegra,
  extra: Partial<Pick<Parcial, "ferramentasAdicionais" | "mensagemCliente" | "semTeto">> = {},
): Parcial {
  return { nivel, acao, ferramenta, motivos: [`${explicacao} ${cita(regra)}`], ...extra };
}

const LIMITE_POR_FERRAMENTA: Partial<Record<Ferramenta, number>> = {
  reenviar_produto: LIMITE_ATENDENTE_REENVIO_RS,
  reimprimir_personalizacao: LIMITE_ATENDENTE_REENVIO_RS,
  trocar_produto: LIMITE_ATENDENTE_TROCA_RS,
  reembolsar: LIMITE_ATENDENTE_REEMBOLSO_RS,
};

// Limite do atendente para a ferramenta; null = ferramenta sem limite de valor.
export function limiteDoAtendente(f: Ferramenta, cenario: CenarioPolitica = CENARIO_PADRAO): number | null {
  if (f === "reenviar_produto" || f === "reimprimir_personalizacao") return cenario.limiteReenvioRs;
  return LIMITE_POR_FERRAMENTA[f] ?? null;
}

// Sorteio determinístico 0-99 (FNV-1a 32 bits): a mesma chave cai sempre na mesma faixa.
export function sorteio(chave: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < chave.length; i++) {
    h ^= chave.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

// ---------------------------------------------------------------------------
// Evidência: probabilidade de a reclamação não proceder e custo esperado
// ---------------------------------------------------------------------------
export function classificarSinais(sinais: readonly SinalEvidencia[]) {
  const unicos = [...new Set(sinais)];
  return {
    fortes: unicos.filter((s): s is SinalForte => (SINAIS_FORTES as readonly string[]).includes(s)),
    fracos: unicos.filter((s): s is SinalFraco => (SINAIS_FRACOS as readonly string[]).includes(s)),
    elegibilidade: unicos.filter((s): s is SinalElegibilidade => (SINAIS_ELEGIBILIDADE as readonly string[]).includes(s)),
  };
}

// Sinais de elegibilidade não contam: não são suspeita.
export function probabilidadeImprocedente(sinais: readonly SinalEvidencia[], pSemSinal: number = PROB_IMPROCEDENTE.nenhumSinal): number {
  const { fortes, fracos } = classificarSinais(sinais);
  if (fortes.length > 0) return PROB_IMPROCEDENTE.algumForte;
  if (fracos.length >= 2) return PROB_IMPROCEDENTE.doisOuMaisFracos;
  if (fracos.length === 1) return PROB_IMPROCEDENTE.umFraco;
  return pSemSinal;
}

// Custo esperado de resolver sem olhar: p × 45% × valor do pedido (parametros.md).
export function custoEsperadoResolver(p: number, valorPedido: number): number {
  return p * FATOR_CUSTO_IMPROCEDENTE * valorPedido;
}

// Resolver sozinho compensa quando o custo esperado do erro é menor que o de sinalizar (R$ 6).
export function compensaResolverSozinho(p: number, valorPedido: number): boolean {
  return custoEsperadoResolver(p, valorPedido) < CUSTO_SINALIZAR_RS;
}

// ---------------------------------------------------------------------------
// Regras por motivo
// ---------------------------------------------------------------------------
function foraDaTabela(o_que: string): Parcial {
  return d(1, "revisao_humana", "encerrar_conversa", `${o_que}: sem regra de autonomia, uma pessoa revisa.`, "fora_da_tabela");
}

function regraAtraso(f: FatosPedido, cenario: CenarioPolitica): Parcial {
  // Atraso acima de 7 dias úteis ou extravio é comprovado pelo portal/ERP: com a regra ligada, nível 0
  // sem teto (até o valor do pedido), reenvio ou reembolso à escolha do cliente.
  const comprovado = (texto: string): Parcial => {
    const n: Nivel = cenario.atrasoComprovadoNivel0 ? 0 : 1;
    const r = d(n, "reenvio_ou_reembolso", "reenviar_produto", `${texto}: reenvio ou reembolso, à escolha do cliente.`, "atraso", {
      ferramentasAdicionais: ["reembolsar"],
      semTeto: n === 0,
    });
    if (n === 0) r.motivos.push(`Comprovado por sistema: nível 0 até o valor do pedido. ${cita("direito_comprovado")}`);
    return r;
  };
  if (f.statusEntrega === "extraviado") return comprovado("Extravio confirmado");
  if (f.diasUteisAtraso === undefined) return foraDaTabela("Atraso sem dias úteis de atraso conhecidos");
  if (f.diasUteisAtraso > ATRASO_LIMITE_DIAS_UTEIS) {
    return comprovado(`Atraso de ${f.diasUteisAtraso} dias úteis, acima de ${ATRASO_LIMITE_DIAS_UTEIS}`);
  }
  if (f.diasUteisAtraso <= 0) {
    return d(0, "informar_status", "informar_status", "Pedido ainda dentro do prazo prometido: informa status e previsão.", "rastreio");
  }
  return d(
    0,
    "abrir_chamado",
    "abrir_chamado_transportadora",
    `Atraso de ${f.diasUteisAtraso} dias úteis, até ${ATRASO_LIMITE_DIAS_UTEIS}: abre chamado com a transportadora.`,
    "atraso",
  );
}

function regraRastreio(f: FatosPedido, cenario: CenarioPolitica): Parcial {
  // Fora do prazo, rastreio é atraso: vale a regra de atraso.
  if (f.statusEntrega === "extraviado" || (f.diasUteisAtraso ?? 0) > ATRASO_LIMITE_DIAS_UTEIS) return regraAtraso(f, cenario);
  if ((f.diasUteisSemAtualizacao ?? 0) >= RASTREIO_PARADO_DIAS_UTEIS) {
    return d(
      0,
      "abrir_chamado",
      "abrir_chamado_transportadora",
      `Rastreio parado há ${f.diasUteisSemAtualizacao} dias úteis (${RASTREIO_PARADO_DIAS_UTEIS} ou mais): abre chamado.`,
      "rastreio",
    );
  }
  if ((f.diasUteisAtraso ?? 0) > 0) return regraAtraso(f, cenario);
  if (f.statusEntrega === "em_transito" || f.statusEntrega === "aguardando_separacao") {
    return d(0, "informar_status", "informar_status", "Pedido dentro do prazo: informa status e previsão.", "rastreio");
  }
  return foraDaTabela(`Rastreio com pedido "${f.statusEntrega}"`);
}

const ACAO_EVIDENCIA: Record<"avaria" | "item_faltante" | "brinde" | "erro_personalizacao", { regra: IdRegra; ferramenta: Ferramenta; acao: string }> = {
  avaria: { regra: "avaria", ferramenta: "reenviar_produto", acao: "reenvio" },
  item_faltante: { regra: "item_faltante", ferramenta: "reenviar_produto", acao: "reenvio" },
  brinde: { regra: "item_faltante", ferramenta: "reenviar_produto", acao: "reenvio" },
  erro_personalizacao: { regra: "erro_personalizacao", ferramenta: "reimprimir_personalizacao", acao: "reimpressao" },
};

function regraEvidencia(motivo: keyof typeof ACAO_EVIDENCIA, e: EntradaPolitica): Parcial {
  const { regra, ferramenta, acao } = ACAO_EVIDENCIA[motivo];
  const cenario = e.cenario ?? CENARIO_PADRAO;
  const f = e.fatos;
  const sinais = [...(e.sinais ?? [])];
  if ((f.reenviosCliente12m ?? 0) >= 2) sinais.push("cliente_2_ou_mais_reenvios_12m");
  const { fortes, fracos, elegibilidade } = classificarSinais(sinais);

  // 1. Elegibilidade (não é suspeita).
  if (f.statusEntrega !== "entregue" || f.diasDesdeRecebimento === undefined) {
    return foraDaTabela(`Reclamação de ${motivo} com pedido "${f.statusEntrega}" ou sem data de recebimento`);
  }
  if (elegibilidade.includes("fora_do_prazo_7_dias") || f.diasDesdeRecebimento > PRAZO_RECLAMACAO_DIAS) {
    return d(
      0,
      "negar_fora_do_prazo",
      "negar_por_politica",
      `Recebido há ${f.diasDesdeRecebimento} dias, acima de ${PRAZO_RECLAMACAO_DIAS}: fora do prazo da política.`,
      regra,
    );
  }
  const semFoto = elegibilidade.includes("sem_foto") || f.temFoto !== true;
  const dispensaFoto = motivo === "brinde" && cenario.brindeSemFoto;
  if (semFoto && !dispensaFoto) {
    return d(0, "solicitar_foto", "solicitar_foto", "A política exige foto: pede a foto antes de decidir.", regra);
  }
  const regraCusto: IdRegra = semFoto ? "brinde_sem_foto" : regra;

  // 2. Sinal forte: sempre nível 2, antes de qualquer fórmula. O supervisor decide.
  //    Nunca nega por suspeita; ao cliente, só "em análise".
  if (fortes.length > 0) {
    return d(2, "sinalizar_suspeita", "sinalizar_suspeita", `Sinal forte de evidência (${fortes.join(", ")}): o supervisor decide.`, "suspeita", {
      mensagemCliente: MENSAGEM_EM_ANALISE,
    });
  }

  // 3. Sem sinal forte, a fórmula decide entre 0 e 1 (inclusive com sinais fracos):
  //    nível 0 se p × 45% × valor do pedido < R$ 6 e o valor da ação cabe no limite do atendente.
  const p = probabilidadeImprocedente(sinais, cenario.pSemSinal);
  const custo = custoEsperadoResolver(p, f.valorPedido);
  const limite = limiteDoAtendente(ferramenta, cenario)!;
  const fracosTxt = fracos.length > 0 ? `sinais fracos: ${fracos.join(", ")}; ` : "sem sinal; ";
  const textoCusto = `${fracosTxt}p=${p.toFixed(2)}, custo esperado ${reais(custo)} contra ${reais(CUSTO_SINALIZAR_RS)} de sinalizar`;
  const compensa = compensaResolverSozinho(p, f.valorPedido);
  const foto = semFoto ? "Brinde sem exigência de foto" : "Foto recebida";
  if (compensa && e.valorAcao <= limite) {
    return d(0, acao, ferramenta, `${foto}, dentro do prazo e de ${reais(limite)} (${textoCusto}).`, regraCusto);
  }
  const porques: string[] = [];
  if (!compensa) porques.push("custo esperado acima do de sinalizar");
  if (e.valorAcao > limite) porques.push(`valor ${reais(e.valorAcao)} acima de ${reais(limite)}`);
  return d(1, acao, ferramenta, `${porques.join("; ")} (${textoCusto}): prepara ${acao} para aprovação.`, regraCusto);
}

function regraCobranca(e: EntradaPolitica): Parcial {
  const f = e.fatos;
  if (f.duplicidadeConfirmadaGateway !== true || f.duplicidadeJaEstornada !== false) {
    return d(1, "verificar_pagamento", "verificar_pagamento", "Duplicidade não confirmada no gateway ou já estornada: uma pessoa verifica.", "fora_da_tabela");
  }
  if ((e.cenario ?? CENARIO_PADRAO).estornoDuplicidadeSemTeto) {
    return d(0, "estorno", "reembolsar", `Duplicidade comprovada no gateway e sem estorno: estorna ${reais(e.valorAcao)} sem teto.`, "estorno_sem_teto", {
      semTeto: true,
    });
  }
  if (e.valorAcao > LIMITE_ATENDENTE_REEMBOLSO_RS) {
    return d(1, "estorno", "reembolsar", `Duplicidade confirmada; estorno de ${reais(e.valorAcao)} acima de ${reais(LIMITE_ATENDENTE_REEMBOLSO_RS)}: supervisor aprova.`, "cobranca_duplicada");
  }
  return d(0, "estorno", "reembolsar", `Duplicidade confirmada no gateway e sem estorno; ${reais(e.valorAcao)} até ${reais(LIMITE_ATENDENTE_REEMBOLSO_RS)}: estorna.`, "cobranca_duplicada");
}

function regraEndereco(f: FatosPedido): Parcial {
  if (f.statusEntrega === "aguardando_separacao" && f.separado === false) {
    return d(0, "alterar_endereco", "alterar_endereco", "Pedido antes da separação: altera o endereço.", "endereco");
  }
  if (f.statusEntrega === "aguardando_separacao") {
    return d(1, "alterar_endereco", "alterar_endereco", "Pedido em separação: uma pessoa confirma se ainda dá para alterar.", "endereco");
  }
  if (f.statusEntrega === "em_transito" || f.statusEntrega === "entregue") {
    return d(0, "recusar_alteracao", "negar_por_politica", `Pedido "${f.statusEntrega}": alteração só antes da separação; explica a política.`, "endereco");
  }
  return foraDaTabela(`Alteração de endereço com pedido "${f.statusEntrega}"`);
}

function regraCancelamento(e: EntradaPolitica): Parcial {
  const f = e.fatos;
  const cenario = e.cenario ?? CENARIO_PADRAO;
  if (f.statusEntrega === "aguardando_separacao" && f.separado === false) {
    if (cenario.cancelamentoAntesSeparacaoNivel0) {
      const r = d(0, "cancelar_e_reembolsar", "cancelar_pedido", "Antes da separação (ERP): cancela o pedido com reembolso integral.", "cancelamento", {
        ferramentasAdicionais: ["reembolsar"],
        semTeto: true,
      });
      r.motivos.push(`Comprovado por sistema: nível 0 até o valor do pedido. ${cita("direito_comprovado")}`);
      return r;
    }
    return d(1, "cancelar", "cancelar_pedido", "Antes da separação: prepara o cancelamento com estorno integral.", "cancelamento");
  }
  if (f.statusEntrega === "entregue" && f.diasDesdeRecebimento !== undefined) {
    return f.diasDesdeRecebimento <= PRAZO_ARREPENDIMENTO_DIAS
      ? d(1, "reembolso_arrependimento", "reembolsar", `Recebido há ${f.diasDesdeRecebimento} dias, até ${PRAZO_ARREPENDIMENTO_DIAS}: prepara reembolso integral com coleta reversa.`, "cancelamento")
      : d(1, "negar_fora_do_prazo", "negar_por_politica", `Recebido há ${f.diasDesdeRecebimento} dias, acima de ${PRAZO_ARREPENDIMENTO_DIAS}: prepara a negativa citando a política.`, "cancelamento");
  }
  return d(1, "revisao_cancelamento", "cancelar_pedido", `Cancelamento com pedido "${f.statusEntrega}": uma pessoa decide.`, "cancelamento");
}

function regraFragrancia(e: EntradaPolitica): Parcial {
  const f = e.fatos;
  const cenario = e.cenario ?? CENARIO_PADRAO;
  const dentroDoPrazo = f.statusEntrega === "entregue" && f.diasDesdeRecebimento !== undefined && f.diasDesdeRecebimento <= PRAZO_TROCA_FRAGRANCIA_DIAS;
  if (cenario.trocaFragranciaNivel0 && dentroDoPrazo && f.trocasNoPedido === 0) {
    return d(
      0,
      "troca_com_coleta_reversa",
      "trocar_produto",
      `Recebido há ${f.diasDesdeRecebimento} dias e sem troca anterior no pedido: troca com coleta reversa; o novo item só sai depois de o CD conferir até ${MAX_USO_FRAGRANCIA_PCT}% de uso.`,
      "troca_coleta",
    );
  }
  if ((f.trocasNoPedido ?? 0) >= MAX_TROCAS_FRAGRANCIA_POR_PEDIDO) {
    return d(1, "negar_troca", "negar_por_politica", `Pedido já teve ${f.trocasNoPedido} troca: limite de ${MAX_TROCAS_FRAGRANCIA_POR_PEDIDO}.`, "troca_fragrancia");
  }
  if (f.diasDesdeRecebimento !== undefined && f.diasDesdeRecebimento > PRAZO_TROCA_FRAGRANCIA_DIAS) {
    return d(1, "negar_troca", "negar_por_politica", `Recebido há ${f.diasDesdeRecebimento} dias, acima de ${PRAZO_TROCA_FRAGRANCIA_DIAS}.`, "troca_fragrancia");
  }
  return d(1, "troca", "trocar_produto", "Troca de fragrância: uma pessoa confirma o uso de até 20% antes de trocar.", "troca_fragrancia");
}

function regraDuvida(e: EntradaPolitica): Parcial {
  if (e.mencaoSaude) {
    return d(2, "atendimento_humano", "responder_duvida", "Dúvida com menção de saúde ou reação: pessoa obrigatória.", "duvida_produto");
  }
  if (e.fatos.temFichaProduto === true) {
    return d(0, "responder_duvida", "responder_duvida", "Responde só com a ficha do produto (produtos.csv).", "duvida_produto");
  }
  return d(1, "responder_duvida", "responder_duvida", "Sem ficha correspondente em produtos.csv: uma pessoa responde.", "duvida_produto");
}

function porMotivo(e: EntradaPolitica): Parcial {
  const f = e.fatos;
  switch (e.motivo) {
    case "rastreio":
      return regraRastreio(f, e.cenario ?? CENARIO_PADRAO);
    case "atraso":
      return regraAtraso(f, e.cenario ?? CENARIO_PADRAO);
    case "avaria":
    case "item_faltante":
    case "brinde":
    case "erro_personalizacao":
      return regraEvidencia(e.motivo, e);
    case "cobranca_duplicada":
      return regraCobranca(e);
    case "endereco":
      return regraEndereco(f);
    case "cancelamento":
      return regraCancelamento(e);
    case "troca_fragrancia":
      return regraFragrancia(e);
    case "duvida_produto":
      return regraDuvida(e);
    case "cupom":
      return d(0, "validar_cupom", "validar_cupom", "Valida o cupom e responde com o motivo calculado pela plataforma.", "cupom");
    case "reacao_adversa":
      return d(
        2,
        "suspender_uso_e_registrar",
        "registrar_cosmetovigilancia",
        "Reação adversa: orienta a suspensão do uso e o supervisor registra a cosmetovigilância em até 24 h; troca não substitui o registro.",
        "reacao_adversa",
        { ferramentasAdicionais: ["orientar_suspensao_uso"] },
      );
    case "pagamento_pendente":
      return d(0, "verificar_e_informar_pagamento", "verificar_pagamento", "Pagamento pendente: verifica no gateway e informa a situação ao cliente.", "pagamento_pendente", {
        ferramentasAdicionais: ["informar_status"],
      });
    case "elogio":
      return d(0, "agradecer", "agradecer", "Elogio: agradece.", "elogio");
    case "sem_interacao":
      return d(1, "encerrar_sem_acao", "encerrar_conversa", "Sem interação do cliente: fora da tabela de autonomia, uma pessoa revisa.", "fora_da_tabela");
    case "outro":
      return foraDaTabela("Motivo não reconhecido");
  }
}

function validar(e: EntradaPolitica): void {
  if (!Number.isFinite(e.confiancaClassificador) || e.confiancaClassificador < 0 || e.confiancaClassificador > 1) {
    throw new RangeError(`confiancaClassificador fora de 0 a 1: ${e.confiancaClassificador}`);
  }
  if (!Number.isFinite(e.valorAcao) || e.valorAcao < 0) throw new RangeError(`valorAcao inválido: ${e.valorAcao}`);
  if (!Number.isFinite(e.fatos.valorPedido) || e.fatos.valorPedido < 0) {
    throw new RangeError(`valorPedido inválido: ${e.fatos.valorPedido}`);
  }
  const c = e.cenario;
  if (c) {
    if (!(c.pSemSinal >= 0 && c.pSemSinal <= 1)) throw new RangeError(`pSemSinal fora de 0 a 1: ${c.pSemSinal}`);
    if (!(c.auditoriaAmostraPct >= 0 && c.auditoriaAmostraPct <= 100)) throw new RangeError(`auditoriaAmostraPct fora de 0 a 100: ${c.auditoriaAmostraPct}`);
    if (!(c.limiteReenvioRs >= 0)) throw new RangeError(`limiteReenvioRs inválido: ${c.limiteReenvioRs}`);
    if (c.freioDiarioRs !== null && !(c.freioDiarioRs >= 0)) throw new RangeError(`freioDiarioRs inválido: ${c.freioDiarioRs}`);
  }
  if (!(MOTIVOS as readonly string[]).includes(e.motivo)) throw new RangeError(`motivo desconhecido: ${e.motivo}`);
}

// ---------------------------------------------------------------------------
// Decisão
// ---------------------------------------------------------------------------
function fotoBloqueada(e: EntradaPolitica, cenario: CenarioPolitica): string | null {
  if (!cenario.bloquearFotosConfirmadas) return null;
  return (e.hashesFotos ?? []).find((h) => cenario.hashesBloqueados.has(h)) ?? null;
}

export function decidirNivel(entrada: EntradaPolitica): DecisaoPolitica {
  validar(entrada);
  const cenario = entrada.cenario ?? CENARIO_PADRAO;

  // Foto já confirmada como fraude: supervisor, antes de qualquer outra regra.
  const bloqueada = fotoBloqueada(entrada, cenario);
  const r: Parcial = bloqueada
    ? d(2, "sinalizar_suspeita", "sinalizar_suspeita", `Foto com hash ${bloqueada.slice(0, 8)}… já confirmado como fraude: o supervisor decide.`, "fotos_bloqueadas", {
        mensagemCliente: MENSAGEM_EM_ANALISE,
      })
    : porMotivo(entrada);
  let nivel = r.nivel;
  const motivos = [...r.motivos];

  // Direito comprovado por sistema: sem teto em R$, mas nunca acima do valor do pedido.
  // Demais ações: limite do atendente; acima dele, pelo menos nível 1.
  const semTeto = r.semTeto === true && nivel === 0;
  if (semTeto) {
    if (entrada.valorAcao > entrada.fatos.valorPedido) {
      nivel = 1;
      motivos.push(`Valor ${reais(entrada.valorAcao)} acima do valor do pedido (${reais(entrada.fatos.valorPedido)}): supervisor aprova. ${cita("direito_comprovado")}`);
    }
  } else {
    const limite = limiteDoAtendente(r.ferramenta, cenario);
    if (limite !== null && entrada.valorAcao > limite && nivel === 0) {
      nivel = 1;
      motivos.push(`Valor ${reais(entrada.valorAcao)} acima do limite do atendente (${reais(limite)}): supervisor aprova. ${cita("limites")}`);
    }
  }
  // Freio diário (rede de segurança das ações sem teto): a que passaria do teto do dia vai para o nível 1.
  const gasto = entrada.gastoAutonomoHojeRs ?? 0;
  if (semTeto && nivel === 0 && cenario.freioDiarioRs !== null && entrada.valorAcao > 0 && gasto + entrada.valorAcao > cenario.freioDiarioRs) {
    nivel = 1;
    motivos.push(`Freio diário: ${reais(gasto)} já executados hoje em ações sem teto + ${reais(entrada.valorAcao)} passam de ${reais(cenario.freioDiarioRs)}. ${cita("freio")}`);
  }
  // Reclame Aqui: resposta pública. Vigente: a conversa inteira sobe para nível 1. Com a separação, a ação
  // segue a regra do motivo e só a resposta (responder_cliente) precisa de aprovação.
  const aprovacaoResposta = entrada.canal === "reclame_aqui";
  if (aprovacaoResposta && cenario.reclameAquiSeparaResposta) {
    motivos.push(`Reclame Aqui: a ação segue a regra do motivo; a resposta pública precisa de aprovação. ${cita("reclame_aqui_resposta")}`);
  } else if (aprovacaoResposta && nivel < 1) {
    nivel = 1;
    motivos.push(`Reclame Aqui: a resposta é pública, uma pessoa aprova. ${cita("reclame_aqui")}`);
  }
  // Confiança baixa do classificador: pelo menos nível 1.
  if (entrada.confiancaClassificador < LIMIAR_CONFIANCA && nivel < 1) {
    nivel = 1;
    motivos.push(`Confiança ${entrada.confiancaClassificador.toFixed(2)} abaixo de ${LIMIAR_CONFIANCA}: sobe para nível 1. ${cita("confianca")}`);
  }

  const decisao: DecisaoPolitica = {
    nivel,
    nivelAcao: nivel,
    aprovacaoResposta,
    acao: r.acao,
    ferramenta: r.ferramenta,
    justificativa: motivos.join(" "),
  };
  if (r.ferramentasAdicionais) decisao.ferramentasAdicionais = r.ferramentasAdicionais;
  if (r.mensagemCliente) decisao.mensagemCliente = r.mensagemCliente;
  if (nivel >= 1 || aprovacaoResposta) decisao.precisaAprovacaoDe = "supervisor";
  if (semTeto && nivel === 0) decisao.acaoSemTeto = true;
  // Auditoria por amostra: o caso de nível 0 executa e entra na fila de revisão posterior.
  if (nivel === 0 && cenario.auditoriaAmostraPct > 0 && entrada.chaveAmostra && sorteio(entrada.chaveAmostra) < cenario.auditoriaAmostraPct) {
    decisao.auditoriaPosterior = true;
    decisao.justificativa += ` Sorteado para auditoria posterior (${cenario.auditoriaAmostraPct}% do nível 0). ${cita("auditoria")}`;
  }
  return decisao;
}

// ---------------------------------------------------------------------------
// Aprovação e decisão de suspeita (segregação de funções)
// ---------------------------------------------------------------------------
export interface Pessoa {
  id: string;
  papel: Papel;
}

export interface Verificacao {
  ok: boolean;
  justificativa: string;
}

// Aprovar ação acima do limite: só supervisor e nunca a própria ação.
export function podeAprovar(aprovador: Pessoa, autorDaAcao: Pessoa): Verificacao {
  if (aprovador.papel !== "supervisor") {
    return { ok: false, justificativa: `Só o supervisor aprova ação acima do limite. ${cita("limites")}` };
  }
  if (aprovador.id === autorDaAcao.id) {
    return { ok: false, justificativa: `O supervisor não aprova a própria ação. ${cita("supervisor")}` };
  }
  return { ok: true, justificativa: `Supervisor aprovando ação de outra pessoa. ${cita("supervisor")}` };
}

// Decidir suspeita: só supervisor e nunca uma que ele mesmo sinalizou.
export function podeDecidirSuspeita(decisor: Pessoa, quemSinalizou: Pessoa): Verificacao {
  if (decisor.papel !== "supervisor") {
    return { ok: false, justificativa: `Quem decide a suspeita é o supervisor. ${cita("suspeita")}` };
  }
  if (decisor.id === quemSinalizou.id) {
    return { ok: false, justificativa: `O supervisor não decide suspeita que ele mesmo sinalizou. ${cita("supervisor")}` };
  }
  return { ok: true, justificativa: `Supervisor decidindo suspeita sinalizada por outra pessoa. ${cita("supervisor")}` };
}
