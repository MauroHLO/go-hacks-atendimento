// Acesso aos dados exportados por analysis/exportar_app.py (app/src/dados/*.json).
// Só leitura. As funções recebem uma `Base` para que os testes usem dados fictícios.

import anexosJson from "../../dados/anexos.json";
import chamadosJson from "../../dados/chamados.json";
import clientesJson from "../../dados/clientes.json";
import conversasJson from "../../dados/conversas.json";
import cuponsJson from "../../dados/cupons.json";
import estornosJson from "../../dados/estornos.json";
import ferramentasJson from "../../dados/ferramentas.json";
import indiceHashJson from "../../dados/indice_hash.json";
import itensJson from "../../dados/itens.json";
import mensagensJson from "../../dados/mensagens.json";
import pagamentosJson from "../../dados/pagamentos.json";
import pedidosJson from "../../dados/pedidos.json";
import politicasJson from "../../dados/politicas.json";
import produtosJson from "../../dados/produtos.json";
import rastreioJson from "../../dados/rastreio.json";
import trocasJson from "../../dados/trocas_reenvios.json";
import usoCuponsJson from "../../dados/uso_cupons.json";
import type { Canal, Papel, StatusEntrega } from "../policy";

// "Agora" do ambiente (parametros.md): segunda-feira, 02/11/2026, 08:00.
export const AGORA = "2026-11-02 08:00:00";

// Datas dos dados são "AAAA-MM-DD" ou "AAAA-MM-DD HH:MM[:SS]" sem fuso: tratadas como UTC ingênuo.
export function instante(data: string): number {
  const iso = data.length === 10 ? `${data}T00:00:00Z` : `${data.replace(" ", "T")}${data.length === 16 ? ":00" : ""}Z`;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) throw new RangeError(`data inválida: ${data}`);
  return t;
}

export function dia(data: string): string {
  return data.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Tipos (colunas descritas em data/raw/atendimento/dicionario_de_dados.md)
// ---------------------------------------------------------------------------
export interface Conversa {
  conversation_id: string;
  customer_id: string;
  order_id: string | null;
  marca: string;
  canal: Canal;
  status: string;
  data_abertura: string;
  n_interacoes: number;
  atendente_id: string | null;
  data_primeira_resposta: string | null;
  assunto: string | null; // mascarado
}

export interface Mensagem {
  conversation_id: string;
  message_id: string;
  autor: "cliente" | "agente" | "bot";
  timestamp: string;
  texto: string; // mascarado
}

export interface Pedido {
  order_id: string;
  customer_id: string;
  marca: string;
  data_pedido: string;
  valor: number;
  sku: string;
  descricao_produto: string;
  personalizacao: string | null;
  transportadora: string;
  uf: string;
  status_entrega: StatusEntrega;
  data_separacao: string | null;
  cd_separacao: string | null;
  maquina_personalizacao: string | null;
  data_entrega: string | null;
  lote_produto: string | null;
  data_prometida: string | null;
  codigo_rastreio: string | null;
  forma_pagamento: string | null;
  cupom: string | null;
  [campo: string]: unknown;
}

export interface Item {
  item_id: string;
  order_id: string;
  sku: string;
  descricao: string;
  tipo_item: "venda" | "brinde";
  quantidade: number;
  valor_total: number;
  personalizacao: string | null;
  texto_personalizacao: string | null;
  lote: string | null;
  [campo: string]: unknown;
}

export interface EventoRastreio {
  portal: string;
  pedido_ref: string;
  data_hora_evento: string;
  status: string;
  local: string | null;
  previsao_entrega: string | null;
  codigo_rastreio: string | null;
}

export interface Pagamento {
  transacao_id: string;
  order_id: string;
  metodo: string;
  status: "capturada" | "paga" | "recusada" | "pendente" | "cancelada" | "estornada";
  valor: number;
  valor_estornado: number;
  data_hora_criacao: string;
  [campo: string]: unknown;
}

export interface Estorno {
  estorno_id: string;
  transacao_id: string;
  order_id: string;
  valor: number;
  motivo: string;
  status: "concluido" | "negado" | "em_processamento";
  data_hora_solicitacao: string;
  [campo: string]: unknown;
}

export interface Chamado {
  chamado_id: string;
  transportadora: string;
  order_id: string;
  conversation_id: string | null;
  data_abertura: string;
  motivo: string;
  prazo_resposta: string | null;
  status: string;
  resposta_transportadora: string | null;
  nova_previsao_entrega: string | null;
  data_encerramento: string | null;
}

export interface TrocaReenvio {
  solicitacao_id: string;
  customer_id: string;
  order_id_original: string;
  tipo: "reenvio" | "troca" | "nova_producao";
  motivo_registrado: string;
  data_solicitacao: string;
  status: string;
  custo_total: number;
  [campo: string]: unknown;
}

export interface Cliente {
  customer_id: string;
  segmento: string;
  n_pedidos: number;
  receita_acumulada: number;
  n_trocas_12m: number;
  aceita_comunicacao_whatsapp: string;
  aceita_comunicacao_email: string;
}

export interface Anexo {
  anexo_id: string;
  conversation_id: string;
  message_id: string | null;
  order_id: string | null;
  customer_id: string;
  canal: string;
  enviado_em: string;
  tipo: string;
  hash_perceptual: string;
  exif_data_captura: string | null;
  exif_modelo_camera: string | null;
  exif_software: string | null;
  descricao_visual: string;
}

export interface OcorrenciaHash {
  anexo_id: string;
  order_id: string | null;
  customer_id: string;
}

export interface Produto {
  sku: string;
  nome: string;
  marca: string;
  categoria: string;
  [campo: string]: unknown;
}

export interface Cupom {
  codigo: string;
  [campo: string]: unknown;
}

export interface UsoCupom {
  uso_id: string;
  codigo: string;
  order_id: string | null;
  customer_id: string;
  status: string;
  motivo_recusa: string | null;
  [campo: string]: unknown;
}

export interface LinhaPolitica {
  secao: string;
  regra: string;
  valor: string | null;
}

export interface DefFerramenta {
  ferramenta: string;
  papeis_permitidos: Papel[];
  descricao: string;
  parametros: string[];
  limites: Record<string, number | boolean>;
}

export interface Base {
  conversas: Conversa[];
  mensagens: Mensagem[];
  pedidos: Pedido[];
  itens: Item[];
  rastreio: EventoRastreio[];
  pagamentos: Pagamento[];
  estornos: Estorno[];
  chamados: Chamado[];
  trocas: TrocaReenvio[];
  clientes: Cliente[];
  anexos: Anexo[];
  indiceHash: Record<string, OcorrenciaHash[]>;
  produtos: Produto[];
  cupons: Cupom[];
  usoCupons: UsoCupom[];
  politicas: LinhaPolitica[];
  ferramentas: DefFerramenta[];
}

export const BASE: Base = {
  conversas: conversasJson as Conversa[],
  mensagens: mensagensJson as Mensagem[],
  pedidos: pedidosJson as Pedido[],
  itens: itensJson as Item[],
  rastreio: rastreioJson as EventoRastreio[],
  pagamentos: pagamentosJson as Pagamento[],
  estornos: estornosJson as Estorno[],
  chamados: chamadosJson as Chamado[],
  trocas: trocasJson as TrocaReenvio[],
  clientes: clientesJson as Cliente[],
  anexos: anexosJson as Anexo[],
  indiceHash: indiceHashJson as Record<string, OcorrenciaHash[]>,
  produtos: produtosJson as Produto[],
  cupons: cuponsJson as Cupom[],
  usoCupons: usoCuponsJson as UsoCupom[],
  politicas: politicasJson as LinhaPolitica[],
  ferramentas: ferramentasJson as unknown as DefFerramenta[],
};

// Base vazia para testes: só preencher o que o caso usa.
export function baseVazia(parcial: Partial<Base> = {}): Base {
  return {
    conversas: [],
    mensagens: [],
    pedidos: [],
    itens: [],
    rastreio: [],
    pagamentos: [],
    estornos: [],
    chamados: [],
    trocas: [],
    clientes: [],
    anexos: [],
    indiceHash: {},
    produtos: [],
    cupons: [],
    usoCupons: [],
    politicas: [],
    ferramentas: BASE.ferramentas, // catálogo real de ferramentas.csv
    ...parcial,
  };
}
