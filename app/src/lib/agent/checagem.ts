// Checagem em código do texto redigido para o cliente (docs/decisoes.md, seção 6).
// Reaproveitada de ../_referencia/app/src/lib/agent/checagem.ts. Mudanças: a "FAQ usada" virou o texto
// permitido (fatos da ficha, regra citada pelo motor e descrição da ação decidida); no nível 0 com a ação
// executada, o texto pode dizer o que foi feito, mas só termos de solução que estejam no texto permitido;
// novas falhas "acusacao" (caso sinalizado nunca acusa) e "politica_sem_fonte" (lei/artigo/CDC sem fonte).
// Se a checagem reprovar, o redator tenta uma vez com o motivo; reprovando de novo, usa TEXTO_RESERVA e o
// orquestrador sobe o caso para o nível 1.

import { mascararPii } from "../pii";
import { normalizar } from "./sinais";

export const TEXTO_RESERVA =
  "Recebemos sua mensagem. Uma pessoa da nossa equipe vai analisar o seu caso e responder por aqui.";
export const MAX_RESPOSTA = 700; // caracteres

export type FalhaChecagem =
  | "formato"
  | "numero_sem_fonte"
  | "numero_por_extenso"
  | "compromisso"
  | "dado_sensivel"
  | "link_sem_fonte"
  | "acao_feita"
  | "promessa_contato"
  | "termo_de_solucao"
  | "acusacao"
  | "politica_sem_fonte";

export interface Permitido {
  textos: readonly string[]; // regra citada, descrição da ação e fatos em texto
  fatos: readonly string[]; // fatos da ficha já formatados (datas, valores, pedido)
  links?: readonly string[];
  nivel: 0 | 1 | 2;
  acaoExecutada: boolean; // nível 0 com a ação já feita pelo agente
}

export interface ResultadoChecagem {
  ok: boolean;
  falhas: FalhaChecagem[];
}

const RE_NUMERO = /\d+(?:[.,/:-]\d+)*/g;
const RE_NUMERO_EXTENSO =
  /\b(dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|trezentos|quinhentos|mil)\b/;
const RE_DADO_SENSIVEL = /\bcpf\b|\bcart(ao|oes)\s+de\s+credito\b|\bnumero\s+do\s+cartao\b|\bsenhas?\b|\bcvv\b|codigo\s+de\s+seguranca/;
const RE_LINK = /\bhttps?:\/\/[^\s)<>"']+|\bwww\.[^\s)<>"']+/gi;
const RE_ACUSACAO = /\bfraud|\bgolpe|\bmentir|\bmentiu|\bfalsific|\bsuspeit|\bma[-\s]fe\b|\bindicios?\b|\benganar|\bforjad|\badulterad/;
const RE_POLITICA_LEGAL = /\bcdc\b|codigo\s+de\s+defesa|\bartigo\b|\bart\.\s*\d|\blei\b|\bprocon\b|\bjudicial\b/;

const PADROES_COMPROMISSO: readonly RegExp[] = [
  /\bgarantimos\b/,
  /\bgarantido\b/,
  /\bvamos\s+(reembolsar|estornar|reenviar|trocar|cancelar)\b/,
  /\bser[a]?\s+(reembolsad|estornad|reenviad|trocad|cancelad)[oa]s?\b/,
  /\bpode\s+ficar\s+tranquil/,
];

const VERBOS_FEITOS =
  "acionamos|acionei|acionou|abrimos|abri|abriu|solicitamos|solicitei|reembolsamos|reembolsei|estornamos|estornei|" +
  "enviamos|enviei|reenviamos|reenviei|cancelamos|cancelei|trocamos|troquei|providenciamos|registramos|registrei|" +
  "encaminhamos|encaminhei|resolvemos|corrigimos|alteramos|alterei|processamos|efetuamos|realizamos|aprovamos";
const PARTICIPIOS = "acionad|abert|solicitad|reembolsad|estornad|reenviad|cancelad|trocad|providenciad|registrad|encaminhad|processad|aprovad|efetuad|realizad|alterad|resolvid";
const OBJETOS = "chamado|solicitacao|protocolo|ocorrencia|reembolso|estorno|reenvio|cancelamento|troca|alteracao";
export const PADROES_ACAO_FEITA: readonly RegExp[] = [
  new RegExp(`\\bja\\s+(${VERBOS_FEITOS})\\b`),
  /\b(acionamos|providenciamos|estornamos|reembolsamos|reenviamos|cancelamos|trocamos|alteramos)\b/,
  /\b(abrimos|abriu|registramos)\s+(um\s+|uma\s+|o\s+|a\s+)?(chamado|solicitacao|protocolo|ocorrencia)\b/,
  new RegExp(`\\bja\\s+(foi|foram|esta|estao)\\s+(${PARTICIPIOS})(o|a|os|as)\\b`),
  new RegExp(`\\b(${OBJETOS})\\s+(ja\\s+)?(foi|foram)\\s+(feit|${PARTICIPIOS})(o|a|os|as)\\b`),
  new RegExp(`\\b(foi|foram)\\s+(feit|${PARTICIPIOS})(o|a|os|as)\\s+(o\\s+|a\\s+|um\\s+|uma\\s+)?(${OBJETOS})\\b`),
];

export const PADROES_PROMESSA_CONTATO: readonly RegExp[] = [
  /\bentrar(emos|a|ao)\s+em\s+contato\b/,
  /\b(vamos|vai|vao|iremos|ira|irao)\s+(entrar\s+em\s+contato|retornar|voltar\s+a\s+falar|avisar|informar|responder)\b/,
  /\bretornar(emos|a|ao)\b/,
  /\b(avisaremos|informaremos|notificaremos|manteremos)\b/,
  /\bem\s+breve\b/,
  /\b(estamos|esta|estao)\s+(acompanhando|verificando|analisando|investigando|monitorando|avaliando)\b/,
];

// Termos de solução e de prazo: só passam se a mesma família estiver no texto permitido.
export const TERMOS_DE_SOLUCAO: Readonly<Record<string, RegExp>> = {
  reposicao: /\b(reposicao|repor|reposto)\b/,
  troca: /\b(troca|trocas|trocar|trocamos|troque)\b|\btrocad[oa]s?\b/,
  reembolso: /\b(reembolso|reembolsos|reembolsar|reembolsamos|reembolsado|reembolsada)\b/,
  estorno: /\b(estorno|estornos|estornar|estornamos|estornado|estornada)\b/,
  reenvio: /\b(reenvio|reenviar|reenviamos|reenviado|reenviada|novo\s+envio)\b/,
  devolucao: /\b(devolucao|devolver|devolvido|devolvida|coleta\s+reversa)\b/,
  cancelamento: /\b(cancelamento|cancelar|cancelamos|cancelado|cancelada)\b/,
  chamado: /\b(chamado|chamados)\b/,
  desconto: /\b(desconto|descontos)\b/,
  cupom: /\b(cupom|cupons)\b/,
  sem_custo: /\bsem\s+custos?\b/,
  gratuito: /\b(gratuito|gratuita|gratis|de\s+graca)\b/,
  hoje: /\bhoje\b/,
  amanha: /\bamanha\b/,
  semana: /\b(nesta|esta|essa|proxima)\s+semana\b/,
  horas: /\b\d+\s*h(oras)?\b|\bnas\s+proximas\s+horas\b/,
};

export function termosDeSolucao(texto: string): string[] {
  const t = normalizar(texto);
  return Object.entries(TERMOS_DE_SOLUCAO)
    .filter(([, re]) => re.test(t))
    .map(([nome]) => nome);
}

export function termosSemFonte(texto: string, permitidos: readonly string[]): string[] {
  const fonte = new Set(permitidos.flatMap(termosDeSolucao));
  return termosDeSolucao(texto).filter((t) => !fonte.has(t));
}

function numeros(texto: string): string[] {
  return texto.match(RE_NUMERO) ?? [];
}

export function verificarResposta(texto: string, p: Permitido): ResultadoChecagem {
  const falhas: FalhaChecagem[] = [];
  const t = normalizar(texto);
  const fontes = [...p.textos, ...p.fatos];
  const fonteNorm = normalizar(fontes.join(" \n "));

  if (texto.trim().length === 0 || texto.length > MAX_RESPOSTA) falhas.push("formato");

  const links = texto.match(RE_LINK) ?? [];
  if (links.some((l) => !(p.links ?? []).includes(l.replace(/[.,;:!?]+$/, "")))) falhas.push("link_sem_fonte");
  const semLinks = texto.replace(RE_LINK, " ");

  const permitidos = new Set(fontes.flatMap(numeros));
  if (numeros(semLinks).some((n) => !permitidos.has(n))) falhas.push("numero_sem_fonte");
  if (RE_NUMERO_EXTENSO.test(t) && !RE_NUMERO_EXTENSO.test(fonteNorm)) falhas.push("numero_por_extenso");

  // CPF, cartão, telefone ou e-mail no texto (pelo padrão do dado ou pela palavra).
  if (mascararPii(texto) !== texto || RE_DADO_SENSIVEL.test(t)) falhas.push("dado_sensivel");
  if (RE_ACUSACAO.test(t)) falhas.push("acusacao");
  if (RE_POLITICA_LEGAL.test(t) && !RE_POLITICA_LEGAL.test(fonteNorm)) falhas.push("politica_sem_fonte");

  if (!p.acaoExecutada) {
    if (PADROES_COMPROMISSO.some((re) => re.test(t))) falhas.push("compromisso");
    if (PADROES_ACAO_FEITA.some((re) => re.test(t))) falhas.push("acao_feita");
  }
  if (p.nivel === 0 && PADROES_PROMESSA_CONTATO.some((re) => re.test(t))) falhas.push("promessa_contato");
  if (termosSemFonte(texto, fontes).length > 0) falhas.push("termo_de_solucao");

  return { ok: falhas.length === 0, falhas };
}

const EXPLICA: Record<FalhaChecagem, string> = {
  formato: `texto vazio ou com mais de ${MAX_RESPOSTA} caracteres`,
  numero_sem_fonte: "número, data ou valor que não está nos fatos",
  numero_por_extenso: "número por extenso",
  compromisso: "promessa de resultado que a ação não garante",
  dado_sensivel: "dado pessoal (CPF, cartão, telefone, e-mail ou senha)",
  link_sem_fonte: "link que não foi fornecido",
  acao_feita: "dizer que uma ação já foi feita quando ela ainda depende de aprovação",
  promessa_contato: "prometer contato, retorno ou acompanhamento",
  termo_de_solucao: "solução, prazo ou benefício que não está na ação decidida",
  acusacao: "tom de suspeita ou acusação ao cliente",
  politica_sem_fonte: "citar lei, artigo ou política que não foi fornecida",
};

export function motivoDaRecusa(falhas: readonly FalhaChecagem[]): string {
  return falhas.map((f) => EXPLICA[f]).join("; ");
}
