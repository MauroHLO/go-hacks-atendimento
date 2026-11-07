// Mascaramento de dados pessoais antes de qualquer envio de texto ao modelo.
// Mesmas expressões de analysis/analise_atendimento.py. O e-mail usa classes
// Unicode porque o \w do JavaScript só cobre ASCII (no Python cobre acentos).

export const RE_CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
export const RE_TELEFONE = /\(\d{2}\)\s?\d{4,5}-\d{4}/g;
export const RE_CARTAO = /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}\b/g;
export const RE_EMAIL = /[\p{L}\p{N}_.-]+@[\p{L}\p{N}_.-]+\.[\p{L}\p{N}_]+/gu;

// O cartão vem primeiro para que seus blocos de dígitos não sejam pegos por outra regra.
export function mascararPii(texto: string): string {
  return texto
    .replace(RE_CARTAO, "[CARTAO]")
    .replace(RE_CPF, "[CPF]")
    .replace(RE_TELEFONE, "[TELEFONE]")
    .replace(RE_EMAIL, "[EMAIL]");
}
