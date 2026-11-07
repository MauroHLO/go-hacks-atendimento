// Leitura local de data/raw/atendimento (fora do Git) para os scripts de análise:
// simular-autonomia, avaliar-jev e casos-demo. Nada daqui vai para o app publicado.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { baseVazia, instante, type Anexo, type Base, type OcorrenciaHash } from "../src/lib/dados";
import type { Motivo } from "../src/lib/policy";

export const RAIZ = existsSync(path.resolve("..", "data", "raw")) ? path.resolve("..") : path.resolve(".");
export const RAW = path.join(RAIZ, "data", "raw", "atendimento");
export const OUT = path.join(RAIZ, "data", "processed");

export type Linha = Record<string, string | number | null>;

// CSV (RFC 4180: aspas, vírgulas e quebras de linha dentro de aspas)
export function lerCsv(nome: string, numericas: readonly string[] = []): Linha[] {
  const texto = readFileSync(path.join(RAW, `${nome}.csv`), "utf8").replace(/^﻿/, "");
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ",") {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += c;
  }
  if (campo !== "" || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }
  const [cab, ...corpo] = linhas.filter((l) => l.length > 1 || l[0] !== "");
  const num = new Set(numericas);
  return corpo.map((l) => Object.fromEntries(cab.map((k, j) => [k, l[j] === "" || l[j] === undefined ? null : num.has(k) ? Number(l[j]) : l[j]])));
}

export function agrupar<T extends Linha>(linhas: T[], chave: string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const l of linhas) {
    const k = l[chave];
    if (k === null || k === undefined) continue;
    const lista = m.get(String(k));
    if (lista) lista.push(l);
    else m.set(String(k), [l]);
  }
  return m;
}

console.log(`Lendo ${RAW}`);
export const conversas = lerCsv("historico_conversas", ["n_interacoes", "csat"]);
export const mensagens = lerCsv("historico_mensagens");
export const pedidos = lerCsv("pedidos", ["valor", "valor_produtos", "desconto", "frete_cobrado", "quantidade_itens", "parcelas"]);
export const itens = lerCsv("itens_pedido", ["linha", "quantidade", "preco_unitario", "desconto_rateado", "valor_total"]);
export const rastreio = lerCsv("rastreio_portais_transportadoras");
export const pagamentos = lerCsv("pagamentos_gateway", ["valor", "valor_estornado", "parcelas"]);
export const estornos = lerCsv("estornos", ["valor"]);
export const chamados = lerCsv("chamados_transportadora");
export const trocas = lerCsv("trocas_reenvios", ["quantidade", "custo_produto", "custo_frete", "custo_manuseio", "custo_total"]);
export const clientes = lerCsv("clientes", ["n_pedidos", "receita_acumulada", "n_trocas_12m", "n_contatos_12m"]);
export const anexos = lerCsv("anexos_conversas") as unknown as Anexo[];
export const produtos = lerCsv("produtos", ["preco_venda", "custo_unitario"]);
export const tempo = lerCsv("tempo_por_conversa", ["minutos_trabalhados", "sistemas_acessados"]);
export const usoCupons = lerCsv("uso_cupons", ["valor_produtos", "valor_desconto"]);
export const cupons = lerCsv("cupons");

export const porConversaMsg = agrupar(mensagens, "conversation_id");
export const porPedido = new Map(pedidos.map((p) => [String(p.order_id), p]));
export const porPedidoItens = agrupar(itens, "order_id");
export const porPedidoRastreio = agrupar(rastreio, "pedido_ref");
export const porPedidoPag = agrupar(pagamentos, "order_id");
export const porPedidoEst = agrupar(estornos, "order_id");
export const porPedidoCham = agrupar(chamados, "order_id");
export const porClienteTrocas = agrupar(trocas, "customer_id");
export const porCliente = new Map(clientes.map((c) => [String(c.customer_id), c]));
export const porConversaAnexos = agrupar(anexos as unknown as Linha[], "conversation_id");
export const minutos = new Map(tempo.map((t) => [String(t.conversation_id), Number(t.minutos_trabalhados)]));
export const nomesCatalogo = produtos.map((p) => String(p.nome));
export const custoBrinde = Number(produtos.find((p) => p.categoria === "Brindes de campanha")?.custo_unitario ?? 0);
export const anexosPorData = [...anexos].sort((a, b) => instante(a.enviado_em) - instante(b.enviado_em));

// Índice de hash só com as fotos enviadas até `t` (sem olhar o futuro).
export function indiceAte(t: number): Record<string, OcorrenciaHash[]> {
  const idx: Record<string, OcorrenciaHash[]> = {};
  for (const a of anexosPorData) {
    if (instante(a.enviado_em) > t) break;
    (idx[a.hash_perceptual] ??= []).push({ anexo_id: a.anexo_id, order_id: a.order_id, customer_id: a.customer_id });
  }
  return idx;
}

// Base só com as linhas de uma conversa (montarContexto filtra por id; isto evita varrer tudo).
export function baseDaConversa(c: Linha, opcoes: { indiceHash?: Record<string, OcorrenciaHash[]> } = {}): Base {
  const id = String(c.conversation_id);
  const orderId = c.order_id ? String(c.order_id) : null;
  const customerId = String(c.customer_id);
  const pedido = orderId ? porPedido.get(orderId) : undefined;
  return baseVazia({
    conversas: [c as never],
    mensagens: (porConversaMsg.get(id) ?? []) as never,
    pedidos: (pedido ? [pedido] : []) as never,
    itens: (orderId ? (porPedidoItens.get(orderId) ?? []) : []) as never,
    rastreio: (orderId ? (porPedidoRastreio.get(orderId) ?? []) : []) as never,
    pagamentos: (orderId ? (porPedidoPag.get(orderId) ?? []) : []) as never,
    estornos: (orderId ? (porPedidoEst.get(orderId) ?? []) : []) as never,
    chamados: (orderId ? (porPedidoCham.get(orderId) ?? []) : []) as never,
    trocas: (porClienteTrocas.get(customerId) ?? []) as never,
    clientes: (porCliente.has(customerId) ? [porCliente.get(customerId)] : []) as never,
    anexos: (porConversaAnexos.get(id) ?? []) as never,
    produtos: produtos as never,
    cupons: cupons as never,
    usoCupons: usoCupons.filter((u) => u.customer_id === customerId) as never,
    indiceHash: opcoes.indiceHash ?? {},
  });
}

// Momento da decisão: a última mensagem do cliente (ou a abertura, se ele não escreveu).
export function momentoDaDecisao(c: Linha): string {
  const doCliente = (porConversaMsg.get(String(c.conversation_id)) ?? []).filter((m) => m.autor === "cliente");
  return String(doCliente.at(-1)?.timestamp ?? c.data_abertura);
}

const RE_BRINDE = /brinde|mimo|necessaire/i;

// tag_agente (rótulo humano) → motivo da taxonomia (docs/decisoes.md, seção 4).
export function motivoDaTag(tag: string | null, pedido: Linha | undefined, texto: string, efetivadas: number, saude: boolean): Motivo {
  switch (tag) {
    case "Rastreio":
      return "rastreio";
    case "Atraso":
      return "atraso";
    case "Avaria":
      return "avaria";
    case "Produto faltando":
      return String(pedido?.descricao_produto ?? "").includes("+ Brinde") && RE_BRINDE.test(texto) ? "brinde" : "item_faltante";
    case "Troca":
      return "troca_fragrancia";
    case "Cancelamento":
      return "cancelamento";
    case "Reclamação produto":
      return saude ? "reacao_adversa" : pedido?.personalizacao ? "erro_personalizacao" : "outro";
    case "Financeiro":
      return efetivadas > 1 ? "cobranca_duplicada" : "pagamento_pendente";
    case "Dúvida":
      return "duvida_produto";
    case "Promoção":
      return "cupom";
    case "Endereço":
      return "endereco";
    case "Elogio":
      return "elogio";
    case "Outros":
      return "outro";
    default:
      return "sem_interacao";
  }
}

// Gerador pseudoaleatório com semente (mulberry32), para amostras reproduzíveis.
export function aleatorio(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
