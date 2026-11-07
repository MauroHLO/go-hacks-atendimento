import { describe, expect, it } from "vitest";
import { mascararPii } from "./index";

// Todos os dados abaixo são fictícios.
describe("mascararPii", () => {
  it("mascara CPF formatado", () => {
    expect(mascararPii("Meu CPF é 123.456.789-09.")).toBe("Meu CPF é [CPF].");
  });

  it("mascara telefone fixo e celular com DDD entre parênteses", () => {
    expect(mascararPii("Liga no (11) 3456-7890")).toBe("Liga no [TELEFONE]");
    expect(mascararPii("Celular (85)98765-4321")).toBe("Celular [TELEFONE]");
  });

  it("mascara e-mail, inclusive com acento", () => {
    expect(mascararPii("Escreve para ana.souza@exemplo.com.br")).toBe("Escreve para [EMAIL]");
    expect(mascararPii("joão_1@exemplo.com")).toBe("[EMAIL]");
  });

  it("mascara cartão com espaço, hífen ou separador misturado", () => {
    expect(mascararPii("Cartão 4111 1111 1111 1111")).toBe("Cartão [CARTAO]");
    expect(mascararPii("Cartão 4111-1111-1111-1111")).toBe("Cartão [CARTAO]");
    expect(mascararPii("Cartão 4111 1111-1111 1111")).toBe("Cartão [CARTAO]");
  });

  it("mascara vários dados no mesmo texto", () => {
    const texto =
      "Sou a Maria, CPF 987.654.321-00, tel (21) 99876-5432, e-mail maria@exemplo.com, " +
      "paguei com 5500 0000 0000 0004 e não recebi.";
    expect(mascararPii(texto)).toBe(
      "Sou a Maria, CPF [CPF], tel [TELEFONE], e-mail [EMAIL], paguei com [CARTAO] e não recebi.",
    );
  });

  it("devolve o texto igual quando não há dado pessoal", () => {
    const texto = "Meu pedido ainda não chegou, podem verificar?";
    expect(mascararPii(texto)).toBe(texto);
    expect(mascararPii("")).toBe("");
  });

  it("não mascara números que a referência não cobre", () => {
    expect(mascararPii("Pedido 123456 de R$ 89,90")).toBe("Pedido 123456 de R$ 89,90");
    expect(mascararPii("CPF 12345678909")).toBe("CPF 12345678909");
    expect(mascararPii("4111 1111 1111")).toBe("4111 1111 1111");
  });

  it("é idempotente", () => {
    const uma = mascararPii("CPF 123.456.789-09 e (11) 3456-7890");
    expect(mascararPii(uma)).toBe(uma);
  });
});
