// Taxonomia de motivos para o Jev (a mesma de lib/policy) e equivalência com a tag_agente do histórico.
// As descrições vêm de politicas.csv (categorias) e parametros.md; servem só para o Jev escolher.

import type { Motivo } from "../policy";

// "sem_demanda" não vai para o Jev: sem mensagem do cliente não há o que classificar.
export const DESCRICAO_MOTIVO: Readonly<Record<Exclude<Motivo, "sem_demanda">, string>> = {
  rastreio: "quer saber onde está o pedido ou o status da entrega, sem reclamar de prazo vencido",
  atraso: "reclama que o pedido passou do prazo de entrega, está parado ou sumiu (extravio)",
  avaria: "produto chegou quebrado, vazando, amassado, rachado ou danificado",
  item_faltante: "faltou um item do pedido (exceto brinde) ou veio quantidade menor",
  brinde: "faltou o brinde da campanha (necessaire, mimo) que deveria vir no pedido",
  erro_personalizacao: "produto Gocase personalizado veio com nome, foto ou iniciais errados, borrados, tortos ou descascando",
  cobranca_duplicada: "foi cobrado duas vezes ou cobrado indevidamente e quer estorno",
  endereco: "quer alterar o endereço de entrega",
  cancelamento: "quer cancelar o pedido, desistiu ou se arrependeu da compra",
  troca_fragrancia: "quer trocar o produto por outra fragrância, cor ou modelo porque não gostou",
  duvida_produto: "dúvida sobre uso, composição, validade ou características de um produto",
  cupom: "dúvida ou problema com cupom, promoção ou desconto",
  reacao_adversa: "teve reação no corpo depois de usar cosmético ou suplemento (alergia, coceira, mancha, irritação, mal-estar)",
  pagamento_pendente: "pagamento por pix ou boleto ainda não confirmado",
  elogio: "elogio ou agradecimento, sem pedido de ação",
  outro: "nenhum dos outros motivos",
};

// politicas.csv › categorias › *.tag_equivalente (Reclamação produto e Outros completados pela leitura dos dados).
export const TAG_DO_MOTIVO: Readonly<Record<Motivo, string>> = {
  rastreio: "Rastreio",
  atraso: "Atraso",
  avaria: "Avaria",
  item_faltante: "Produto faltando",
  brinde: "Produto faltando",
  erro_personalizacao: "Reclamação produto",
  cobranca_duplicada: "Financeiro",
  endereco: "Endereço",
  cancelamento: "Cancelamento",
  troca_fragrancia: "Troca",
  duvida_produto: "Dúvida",
  cupom: "Promoção",
  reacao_adversa: "Reclamação produto",
  pagamento_pendente: "Financeiro",
  elogio: "Elogio",
  outro: "Outros",
  sem_demanda: "(sem tag)",
};

export const SINAIS_TEXTO = {
  reacao_adversa: "O cliente relata reação no corpo (alergia, coceira, irritação, mancha, mal-estar) depois de usar um cosmético ou suplemento?",
  mencao_saude: "O cliente menciona saúde, gravidez, amamentação, criança, alergia ou condição médica?",
  ameaca_reclame_aqui_ou_procon: "O cliente ameaça reclamar no Reclame Aqui, no Procon, na justiça ou com advogado?",
  cliente_irritado: "O cliente demonstra irritação ou impaciência?",
  pede_ou_envia_dado_sensivel: "O cliente envia ou pede CPF, número de cartão, senha ou outro dado pessoal sensível?",
  mais_de_um_motivo: "A mensagem trata de mais de um assunto diferente (por exemplo, atraso e cobrança)?",
} as const;
export type SinalTexto = keyof typeof SINAIS_TEXTO;

export const NIVEIS_URGENCIA = ["baixa", "media", "alta"] as const;
export type Urgencia = (typeof NIVEIS_URGENCIA)[number];
