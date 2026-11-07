import { describe, expect, it } from "vitest";
import { baseVazia, type Base, type Conversa } from "../dados";
import { FalhaIA, type ClienteIA } from "./cliente";
import { contingenciaGravada, resultadoGravado } from "./contingencia";
import { clienteFalso, respostaChat, respostaJev } from "./fetch-falso";
import { baseComTeste, comNovaTentativa, ConversaDesconhecida, criarAgente, falhaDaRota, Semaforo } from "./servico";

// ---------- base fictícia ----------
const CONV: Conversa = {
  conversation_id: "AT900001", customer_id: "CH900001", order_id: "P1", marca: "Kokeshi", canal: "whatsapp", status: "pendente",
  data_abertura: "2026-11-01 21:00:00", n_interacoes: 2, atendente_id: null, data_primeira_resposta: null, assunto: null,
};
function base(): Base {
  return baseVazia({
    conversas: [CONV, { ...CONV, conversation_id: "AT900002" }],
    mensagens: [
      { conversation_id: "AT900001", message_id: "M1", autor: "cliente", timestamp: "2026-11-01 21:01:00", texto: "Obrigada, amei o sérum! CPF 123.456.789-00" },
      { conversation_id: "AT900002", message_id: "M2", autor: "bot", timestamp: "2026-11-01 21:00:00", texto: "Olá! Estamos fora do horário." },
    ],
    pedidos: [{
      order_id: "P1", customer_id: "CH900001", marca: "Kokeshi", data_pedido: "2026-10-20", valor: 99.9, sku: "KSH-TESTE", descricao_produto: "Sérum Teste 30ml",
      personalizacao: null, transportadora: "ViaLog", uf: "SP", status_entrega: "entregue", data_separacao: "2026-10-21 10:00:00", cd_separacao: "CD1",
      maquina_personalizacao: null, data_entrega: "2026-10-30", lote_produto: "LT1", data_prometida: "2026-10-27", codigo_rastreio: "VL000", forma_pagamento: "cartao", cupom: null,
    }],
    clientes: [{ customer_id: "CH900001", segmento: "novo", n_pedidos: 1, receita_acumulada: 100, n_trocas_12m: 0, aceita_comunicacao_whatsapp: "sim", aceita_comunicacao_email: "sim" }],
  });
}
const semEspera = async () => undefined;
const OBRIGADO = "Que bom que você gostou! Agradecemos o carinho.";

describe("Semaforo", () => {
  it("no máximo 2 ao mesmo tempo; os demais esperam e todos terminam", async () => {
    const s = new Semaforo(2);
    let ativos = 0;
    let pico = 0;
    const tarefa = () =>
      s.usar(async () => {
        ativos++;
        pico = Math.max(pico, ativos);
        await new Promise((ok) => setTimeout(ok, 5));
        ativos--;
        return 1;
      });
    const r = await Promise.all(Array.from({ length: 7 }, tarefa));
    expect(r).toHaveLength(7);
    expect(pico).toBe(2);
    expect(s.emUso).toBe(0);
    expect(s.esperando).toBe(0);
  });

  it("exceção libera a vaga", async () => {
    const s = new Semaforo(1);
    await expect(s.usar(async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(await s.usar(async () => 2)).toBe(2);
  });
});

describe("nova tentativa no 429", () => {
  const ia = (falhas: FalhaIA[]): { ia: ClienteIA; chamadas: () => number } => {
    let n = 0;
    return {
      chamadas: () => n,
      ia: {
        modelo: "m",
        jev: async () => { throw new Error("não usado"); },
        chat: async () => {
          const f = falhas[n++];
          if (f) throw f;
          return { texto: "ok", modelo: "m", uso: { entrada: 1, saida: 1, custoUsd: null }, ms: 1 };
        },
      },
    };
  };
  it.each([
    ["429", new FalhaIA("http", 429)],
    ["503", new FalhaIA("http", 503)],
    ["rede", new FalhaIA("rede")],
  ])("%s: repete uma vez", async (_n, falha) => {
    const f = ia([falha]);
    expect((await comNovaTentativa(f.ia, semEspera).chat([])).texto).toBe("ok");
    expect(f.chamadas()).toBe(2);
  });
  it("timeout e 400 não repetem; segundo 429 propaga", async () => {
    for (const falha of [new FalhaIA("timeout"), new FalhaIA("http", 400)]) {
      const f = ia([falha]);
      await expect(comNovaTentativa(f.ia, semEspera).chat([])).rejects.toBe(falha);
      expect(f.chamadas()).toBe(1);
    }
    const f = ia([new FalhaIA("http", 429), new FalhaIA("http", 429)]);
    await expect(comNovaTentativa(f.ia, semEspera).chat([])).rejects.toBeInstanceOf(FalhaIA);
    expect(f.chamadas()).toBe(2);
  });
  it("falha do classificador → tipo da rota", () => {
    expect(falhaDaRota("http", 429)).toBe("rate_limit");
    expect(falhaDaRota("http", 502)).toBe("indisponivel");
    expect(falhaDaRota("timeout", null)).toBe("timeout");
    expect(falhaDaRota("resposta_invalida", null)).toBe("json_invalido");
    expect(falhaDaRota(null, null)).toBeNull();
  });
});

describe("criarAgente", () => {
  it("conversa da fila: orquestrador de ponta a ponta, resumo com a ficha da decisão", async () => {
    const { ia } = clienteFalso({ jev: [{ json: respostaJev("elogio") }], chat: [{ json: respostaChat(OBRIGADO) }] });
    const r = await criarAgente({ ia, base: base(), esperar: semEspera })({ conversation_id: "AT900001", mensagem: null });
    expect(r).toMatchObject({ nivel: 0, teste: false, resposta: OBRIGADO, classificacaoValida: true, falha: null });
    expect(r.caso.decisao.ferramenta).toBe("agradecer");
    expect(r.caso.log.map((l) => l.acao)).toContain("responder_cliente");
  });

  it("mensagem fictícia: conversa de teste ligada ao pedido, só o texto digitado vai (mascarado) ao Jev", async () => {
    const { ia, chamadas } = clienteFalso({ jev: [{ json: respostaJev("rastreio") }], chat: [{ json: respostaChat("Seu pedido P1 consta como entregue.") }] });
    const r = await criarAgente({ ia, base: base(), esperar: semEspera })({ conversation_id: "AT900001", mensagem: "Cadê meu pedido? CPF 987.654.321-00" });
    expect(r.teste).toBe(true);
    expect(r.caso.conversation_id).toBe("TESTE-AT900001");
    expect(r.caso.order_id).toBe("P1");
    const state = JSON.stringify(chamadas[0].corpo);
    expect(state).toContain("Cadê meu pedido");
    expect(state).not.toContain("987.654.321-00");
    expect(state).not.toContain("amei o sérum"); // mensagens originais ficam de fora
  });

  it("sem demanda (só o bot): nível 0, sem chamar o modelo", async () => {
    const { ia, chamadas } = clienteFalso({});
    const r = await criarAgente({ ia, base: base(), esperar: semEspera })({ conversation_id: "AT900002", mensagem: null });
    expect(r).toMatchObject({ nivel: 0, resposta: null });
    expect(r.caso.classificacao.motivo).toBe("sem_demanda");
    expect(chamadas).toHaveLength(0);
  });

  it("429 no Jev nas duas tentativas: falha rate_limit (a rota usa a contingência)", async () => {
    const { ia } = clienteFalso({ jev: [{ status: 429 }] });
    const r = await criarAgente({ ia, base: base(), esperar: semEspera })({ conversation_id: "AT900001", mensagem: null });
    expect(r.falha).toEqual({ tipo: "rate_limit" });
    expect(r.nivel).toBe(2);
  });

  it("conversa que não existe", async () => {
    const { ia } = clienteFalso({});
    await expect(criarAgente({ ia, base: base() })({ conversation_id: "AT1", mensagem: null })).rejects.toBeInstanceOf(ConversaDesconhecida);
  });

  it("no máximo 2 conversas no orquestrador ao mesmo tempo", async () => {
    let ativos = 0;
    let pico = 0;
    const { ia: falso } = clienteFalso({ jev: [{ json: respostaJev("elogio") }], chat: [{ json: respostaChat(OBRIGADO) }] });
    const ia: ClienteIA = {
      modelo: "m",
      jev: async (...a) => {
        ativos++;
        pico = Math.max(pico, ativos);
        await new Promise((ok) => setTimeout(ok, 5));
        ativos--;
        return falso.jev(...a);
      },
      chat: (...a) => falso.chat(...a),
    };
    const agente = criarAgente({ ia, base: base(), esperar: semEspera });
    await Promise.all(Array.from({ length: 6 }, () => agente({ conversation_id: "AT900001", mensagem: null })));
    expect(pico).toBe(2);
  });
});

describe("conversa de teste e contingência", () => {
  it("baseComTeste não altera a base original", () => {
    const b = base();
    const { base: nova, id } = baseComTeste(b, CONV, "oi");
    expect(id).toBe("TESTE-AT900001");
    expect(b.conversas).toHaveLength(2);
    expect(nova.conversas).toHaveLength(3);
    expect(nova.mensagens.filter((m) => m.conversation_id === id)).toEqual([expect.objectContaining({ autor: "cliente", texto: "oi" })]);
  });

  it("contingência: resultado gravado do lote, com aviso; conversa sem gravação → null", async () => {
    const id = "AT116160"; // primeira conversa da fila gravada
    expect(resultadoGravado(id)?.conversation_id).toBe(id);
    const r = await contingenciaGravada({ conversation_id: id, mensagem: "oi" }, "rate_limit");
    expect(r?.caso.conversation_id).toBe(id);
    expect(r?.contingencia).toMatchObject({ motivo: "rate_limit" });
    expect(r?.contingencia.aviso).toContain("a mensagem digitada não foi processada");
    expect(r?.falha).toBeNull();
    expect(await contingenciaGravada({ conversation_id: "AT1", mensagem: null }, "timeout")).toBeNull();
  });
});
