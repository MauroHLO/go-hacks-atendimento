// Sinais de saúde e de ameaça por palavra-chave (docs/decisoes.md, seção 14).
// Portados de RE_SAUDE e RE_AMEACA em analysis/analise_atendimento.py, aplicados sobre texto
// normalizado (minúsculas, sem acento). No pipeline, o sinal final é "ou" com a saída do modelo.
//
// Divergências em relação ao Python (todas registradas na seção 14):
// - o texto é normalizado, então "gravida", "bebe" e "justica" também casam;
// - "queima" virou queimadura|queimou|queimei|queimando|queimação (não pega "queima de estoque");
// - "grávida" e "bebê" exigem palavra inteira (não pegam "gravidade" nem "bebeu");
// - "fórmula" só depois de artigo feminino ("na fórmula", "da fórmula", "a fórmula" e plurais): não pega
//   "formulário" nem nomes de produto que começam com Fórmula, que vêm com artigo masculino
//   (docs/decisoes.md, seção 16). Resíduo conhecido: nome de produto precedido de "a", "da" ou "na" ainda casa;
// - "bolinhas" só com contexto de pele (não pega "capinha de bolinhas");
// - "meu filho" e "minha filha" exigem fim de palavra (não pegam "meu filhote");
// - "justiça" exige palavra inteira (não pega "injustiça");
// - espaços entre palavras aceitam qualquer quantidade (\s+).
// Aceitos como estão, apesar de colisões conhecidas: "bebe" (verbo beber), "queimou" (eletrônico)
// e "reclame aqui" (imperativo), porque o erro é na direção conservadora.

export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export const RE_SAUDE =
  /gravidez|\bgravidas?\b|gestante|amament|\bbebes?\b|minha\s+filha\b|meu\s+filho\b|alerg|inchad|coceira|queimadura|queimou|queimei|queimando|queimac(ao|oes)\b|bolinhas\s+(na|no|pela|pelo|em)\s+(pele|rosto|corpo|braco|perna)\b|\b(na|da|a|nas|das|as)\s+formulas?\b/;

export const RE_AMEACA = /procon|advogad|processo\s+judicial|\bjustica\b|abrir\s+reclamacao|reclame\s+aqui/;

export interface Sinais {
  saude: boolean;
  ameaca: boolean;
}

export function detectarSinais(texto: string): Sinais {
  const t = normalizar(texto);
  return { saude: RE_SAUDE.test(t), ameaca: RE_AMEACA.test(t) };
}
