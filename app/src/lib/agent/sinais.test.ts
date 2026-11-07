import { describe, expect, it } from "vitest";
import { detectarSinais, normalizar } from "./sinais";

describe("normalizar", () => {
  it("remove acentos e passa para minúsculas", () => {
    expect(normalizar("Grávida, BEBÊ, Justiça, Reclamação")).toBe("gravida, bebe, justica, reclamacao");
  });
});

describe("saúde", () => {
  it.each([
    "Estou grávida, posso usar?",
    "somos grávidas de gêmeos",
    "estou gravida e quero saber",
    "Durante a gravidez pode?",
    "sou gestante",
    "estou amamentando",
    "é para o meu bebê",
    "uso no bebe",
    "presente para os bebês",
    "minha filha usou",
    "meu  filho passou",
    "tenho alergia a perfume",
    "fiquei alérgica",
    "o rosto ficou inchado",
    "deu coceira",
    "tive uma queimadura",
    "queimou minha pele",
    "queimei o rosto",
    "está queimando",
    "senti uma queimação forte no couro cabeludo",
    "deu queimacao na pele",
    "tive queimações depois do creme",
    "apareceram bolinhas na pele",
    "bolinhas no rosto depois do creme",
    "bolinhas pelo corpo",
    "bolinhas no braço",
    "bolinhas em perna e braço",
    "minha filha, usou e pronto",
    "qual é a fórmula?",
    "as formulas mudaram?",
    "o que tem na fórmula?",
    "quais os ingredientes da fórmula?",
    "a fórmula tem parabeno?",
    "mudaram a fórmula do creme?",
  ])("detecta: %s", (texto) => {
    expect(detectarSinais(texto).saude).toBe(true);
  });

  it.each([
    "quando chega meu pedido?",
    "vi a queima de estoque no site",
    "qual a gravidade do atraso?",
    "Gravidade: alta",
    "a promoção é uma queima total",
    "a queima de estoque acabou ontem",
    "queimaram o meu pedido de prioridade", // verbo queimar em outro sentido, sem "queimação"
    "ele bebeu água",
    "preenchi o formulário",
    // nomes de produto com Fórmula: moldes sintéticos dos 9 falsos positivos da seção 16 (produtos inventados)
    "Comprei o Fórmula Brilho Extra há dez dias e nada chegou. Cadê?",
    "Meu pedido do Fórmula Sono Leve ainda não chegou",
    "O frasco do Fórmula Pele Nova chegou rachado",
    "Qual a validade do Fórmula Brilho Extra depois de aberto?",
    "Como devolvo o Fórmula Sono Leve?",
    "Quero trocar o Fórmula Pele Nova, não gostei",
    "cadê o Fórmula Cabelo Forte que comprei?",
    "o Fórmula Unhas Fortes veio com a tampa quebrada",
    "devolver os Fórmulas Vitais que pedi",
    "minha capinha veio errada",
    "comprei a capinha de bolinhas",
    "apareceram bolinhas",
    "meu filhote mordeu a capinha",
    "minha filhada", // borda de palavra no fim
  ])("não detecta: %s", (texto) => {
    expect(detectarSinais(texto).saude).toBe(false);
  });
});

describe("ameaça", () => {
  it.each([
    "vou no Procon",
    "vou chamar meu advogado",
    "minha advogada vai ver isso",
    "vou abrir um processo  judicial",
    "vou na Justiça",
    "vou na justica",
    "vou à justiça",
    "vou abrir reclamação",
    "vou abrir reclamacao",
    "vou postar no Reclame Aqui",
    "RECLAME AQUI",
  ])("detecta: %s", (texto) => {
    expect(detectarSinais(texto).ameaca).toBe(true);
  });

  it.each(["quero trocar o tamanho", "obrigada pelo atendimento", "abri o pacote", "que injustiça!", "isso é uma injustica"])("não detecta: %s", (texto) => {
    expect(detectarSinais(texto).ameaca).toBe(false);
  });
});

it("resíduo conhecido: nome de produto precedido de artigo feminino ainda marca saúde", () => {
  expect(detectarSinais("comprei a Fórmula Brilho Extra").saude).toBe(true);
  expect(detectarSinais("a tampa da Fórmula Sono Leve quebrou").saude).toBe(true);
});

it("saúde e ameaça são independentes", () => {
  expect(detectarSinais("estou grávida e vou no Procon")).toEqual({ saude: true, ameaca: true });
  expect(detectarSinais("cadê meu pedido?")).toEqual({ saude: false, ameaca: false });
});
