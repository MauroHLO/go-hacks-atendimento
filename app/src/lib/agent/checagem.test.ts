import { describe, expect, it } from "vitest";
import { MAX_RESPOSTA, motivoDaRecusa, previsaoVencida, TEXTO_RESERVA, verificarResposta, type Permitido } from "./checagem";

const FATOS = ["Pedido GBH900001 (Kokeshi), valor R$ 129,90.", "Data prometida de entrega: 27/10/2026.", "Status: em trânsito; transportadora Expressa Já."];
const nivel0 = (descricao: string): Permitido => ({ textos: [descricao], fatos: FATOS, nivel: 0, acaoExecutada: true });
const nivel1 = (descricao: string): Permitido => ({ textos: [descricao], fatos: FATOS, nivel: 1, acaoExecutada: false });

describe("aprova", () => {
  it("texto só com os fatos e a ação executada", () => {
    const r = verificarResposta(
      "Seu pedido GBH900001 está em trânsito com a Expressa Já. Abrimos um chamado com a transportadora sobre a entrega.",
      nivel0("Abrimos um chamado com a Expressa Já sobre a entrega do pedido."),
    );
    expect(r).toEqual({ ok: true, falhas: [] });
  });
  it("texto de reserva no nível 1", () => {
    expect(verificarResposta(TEXTO_RESERVA, nivel1("depende de análise")).ok).toBe(true);
  });
  it("data e valor copiados dos fatos", () => {
    expect(verificarResposta("A data prometida era 27/10/2026 e o valor, R$ 129,90.", nivel0("informar status")).ok).toBe(true);
  });
});

describe("reprova", () => {
  it.each<[string, string, Permitido, string]>([
    ["número sem fonte", "Seu pedido chega em 3 dias.", nivel0("informar status"), "numero_sem_fonte"],
    ["data fora dos fatos", "A entrega será em 30/10/2026.", nivel0("informar status"), "numero_sem_fonte"],
    ["número por extenso", "Chega em cinco dias úteis.", nivel0("informar status"), "numero_por_extenso"],
    ["acusação", "Sua solicitação é suspeita e está sob análise de fraude.", nivel1("análise"), "acusacao"],
    ["CPF no texto", "Confirmamos o CPF 123.456.789-00.", nivel0("informar status"), "dado_sensivel"],
    ["pedir senha", "Informe sua senha para continuar.", nivel0("informar status"), "dado_sensivel"],
    ["lei sem fonte", "Pelo CDC, você tem direito ao reembolso.", nivel1("análise do reembolso"), "politica_sem_fonte"],
    ["ação feita sem estar executada", "Já reenviamos o produto.", nivel1("Reenvio do produto depende de aprovação"), "acao_feita"],
    ["promessa de resultado no nível 1", "Garantimos o reembolso.", nivel1("Reembolso depende de aprovação"), "compromisso"],
    ["promessa de contato no nível 0", "Em breve entraremos em contato.", nivel0("informar status"), "promessa_contato"],
    ["solução que a ação não faz", "Abrimos um chamado e vamos te dar um cupom de desconto.", nivel0("Abrimos um chamado com a transportadora."), "termo_de_solucao"],
    ["reembolso quando a ação é reenvio", "Fizemos o reembolso do pedido.", nivel0("Reenvio do produto sem custo."), "termo_de_solucao"],
    ["link inventado", "Acompanhe em https://rastreio.exemplo.com/x", nivel0("informar status"), "link_sem_fonte"],
    ["texto longo demais", "a".repeat(MAX_RESPOSTA + 1), nivel0("informar status"), "formato"],
  ])("%s", (_n, texto, permitido, falha) => {
    const r = verificarResposta(texto, permitido);
    expect(r.ok).toBe(false);
    expect(r.falhas).toContain(falha);
  });

  it("ação executada no nível 0 pode ser narrada", () => {
    expect(verificarResposta("Fizemos o reenvio sem custo do produto.", nivel0("Reenvio do produto sem custo para o cliente.")).ok).toBe(true);
  });

  it("nível 1 pode dizer que a equipe vai analisar", () => {
    expect(verificarResposta("Uma pessoa da equipe vai analisar e retornará por aqui.", nivel1("depende de análise")).ok).toBe(true);
  });

  it("motivo da recusa em linguagem para o modelo", () => {
    expect(motivoDaRecusa(["numero_sem_fonte", "acusacao"])).toBe("número, data ou valor que não está nos fatos; tom de suspeita ou acusação ao cliente");
  });
});

describe("previsão de entrega vencida (agora = 02/11/2026 08:00)", () => {
  const AGORA = "2026-11-02 08:00:00";
  const comAgora = (p: Permitido): Permitido => ({ ...p, agora: AGORA });
  it.each([
    ["previsão anterior a agora", "A previsão informada pela transportadora é 29/10/2026."],
    ["prazo vencido sem ano", "O prazo de entrega era 27/10."],
    ["chega numa data que já passou", "Seu pedido chega em 30/10/2026."],
  ])("%s: recusa", (_n, texto) => {
    const r = verificarResposta(texto, comAgora(nivel0("informar status")));
    expect(r.falhas).toContain("previsao_vencida");
  });
  it.each([
    ["atraso sem a data vencida", "O prazo de entrega já passou: seu pedido está atrasado. Abrimos um chamado com a Expressa Já."],
    ["previsão futura", "A previsão de entrega é 05/11/2026."],
    ["data de entrega passada como fato", "O pedido foi entregue em 30/10/2026."],
  ])("%s: não recusa por previsão", (_n, texto) => {
    expect(previsaoVencida(texto, AGORA)).toBe(false);
  });
  it("sem agora informado, a regra não se aplica (compatível com chamadas antigas)", () => {
    expect(verificarResposta("A data prometida era 27/10/2026.", nivel0("informar status")).falhas).not.toContain("previsao_vencida");
  });
  it("motivo da recusa orienta a dizer que está atrasado", () => {
    expect(motivoDaRecusa(["previsao_vencida"])).toContain("atrasado");
  });
});
