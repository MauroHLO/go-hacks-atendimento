// Simulação de autonomia (docs/decisoes.md, seção 4).
// Passa as 2.984 conversas do histórico pelo motor REAL (lib/contexto, lib/evidencias, lib/policy) em
// vários cenários de política e mede autonomia, horas liberadas, perda esperada, atrito e auditoria.
// Lê data/raw/atendimento localmente (fora do Git) e grava só agregados em data/processed/.
//
// Uso (em app/): npm run simular
//
// Cenários cumulativos (seções 4 e 5 de docs/decisoes.md): vigente → base ajustada → + cancelamento antes da
// separação → + atraso comprovado → + troca de fragrância → + Reclame Aqui separa ação e resposta → + freio
// de R$ 3.000/dia (= CENARIO_PADRAO).
//
// Limitações (repetidas no JSON de saída):
// - o motivo vem da tag_agente (rótulo humano posto ao encerrar), não do classificador; confiança 1,0;
// - conversa sem tag = só bot: nível 1 (sem_interacao);
// - o pedido é reconstruído na data da última mensagem do cliente (lib/contexto/pedidoNaData);
// - reenvios do cliente contados no OMS nos 365 dias anteriores (o CRM é posição de 02/11);
// - a lista de fotos bloqueadas é preenchida supondo que o supervisor confirma toda foto sinalizada por
//   hash repetido (limite superior do efeito);
// - p (probabilidade de a reclamação não proceder) é hipótese: por isso a sensibilidade em 0,02/0,05/0,10.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { detectarSinais } from "../src/lib/agent/sinais";
import { fatosParaPolitica, montarContexto, STATUS_COBRANCA_EFETIVADA } from "../src/lib/contexto";
import { baseVazia, dia, instante, type Anexo, type Base, type OcorrenciaHash } from "../src/lib/dados";
import { calcularSinais } from "../src/lib/evidencias";
import {
  CENARIO_PADRAO,
  CENARIO_VIGENTE,
  classificarSinais,
  CUSTO_AUDITORIA_RS,
  CUSTO_SINALIZAR_RS,
  decidirNivel,
  FATOR_CUSTO_IMPROCEDENTE,
  probabilidadeImprocedente,
  type CenarioPolitica,
  type FatosPedido,
  type Motivo,
  type SinalEvidencia,
} from "../src/lib/policy";

// ---------------------------------------------------------------------------
// Parâmetros (parametros.md) e escala
// ---------------------------------------------------------------------------
const FATOR_AMOSTRA = 4; // amostra de 1 em cada 4 clientes
const MESES = 3; // 04/08 a 01/11 = 90 dias
const ESCALA_MES = FATOR_AMOSTRA / MESES;
const CUSTO_CANAL: Record<string, number> = { whatsapp: 4.8, email: 7.2, reclame_aqui: 42 };
const VALORES_P = [0.02, 0.05, 0.1];
const MOTIVOS_EVIDENCIA: ReadonlySet<Motivo> = new Set(["avaria", "item_faltante", "brinde", "erro_personalizacao"]);

const RAIZ = existsSync(path.resolve("..", "data", "raw")) ? path.resolve("..") : path.resolve(".");
const RAW = path.join(RAIZ, "data", "raw", "atendimento");
const OUT = path.join(RAIZ, "data", "processed");

// ---------------------------------------------------------------------------
// CSV (RFC 4180: aspas, vírgulas e quebras de linha dentro de aspas)
// ---------------------------------------------------------------------------
type Linha = Record<string, string | number | null>;

function lerCsv(nome: string, numericas: readonly string[] = []): Linha[] {
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

function agrupar<T extends Linha>(linhas: T[], chave: string): Map<string, T[]> {
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

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------
console.log(`Lendo ${RAW}`);
const conversas = lerCsv("historico_conversas", ["n_interacoes", "csat"]);
const mensagens = lerCsv("historico_mensagens");
const pedidos = lerCsv("pedidos", ["valor", "valor_produtos", "desconto", "frete_cobrado", "quantidade_itens", "parcelas"]);
const itens = lerCsv("itens_pedido", ["linha", "quantidade", "preco_unitario", "desconto_rateado", "valor_total"]);
const rastreio = lerCsv("rastreio_portais_transportadoras");
const pagamentos = lerCsv("pagamentos_gateway", ["valor", "valor_estornado", "parcelas"]);
const estornos = lerCsv("estornos", ["valor"]);
const chamados = lerCsv("chamados_transportadora");
const trocas = lerCsv("trocas_reenvios", ["quantidade", "custo_produto", "custo_frete", "custo_manuseio", "custo_total"]);
const clientes = lerCsv("clientes", ["n_pedidos", "receita_acumulada", "n_trocas_12m", "n_contatos_12m"]);
const anexos = lerCsv("anexos_conversas") as unknown as Anexo[];
const produtos = lerCsv("produtos", ["preco_venda", "custo_unitario"]);
const tempo = lerCsv("tempo_por_conversa", ["minutos_trabalhados", "sistemas_acessados"]);

const porConversaMsg = agrupar(mensagens, "conversation_id");
const porPedido = new Map(pedidos.map((p) => [String(p.order_id), p]));
const porPedidoItens = agrupar(itens, "order_id");
const porPedidoRastreio = agrupar(rastreio, "pedido_ref");
const porPedidoPag = agrupar(pagamentos, "order_id");
const porPedidoEst = agrupar(estornos, "order_id");
const porPedidoCham = agrupar(chamados, "order_id");
const porClienteTrocas = agrupar(trocas, "customer_id");
const porCliente = new Map(clientes.map((c) => [String(c.customer_id), c]));
const porConversaAnexos = agrupar(anexos as unknown as Linha[], "conversation_id");
const minutos = new Map(tempo.map((t) => [String(t.conversation_id), Number(t.minutos_trabalhados)]));
const nomesCatalogo = produtos.map((p) => String(p.nome));
const custoBrinde = Number(produtos.find((p) => p.categoria === "Brindes de campanha")?.custo_unitario ?? 0);
const anexosPorData = [...anexos].sort((a, b) => instante(a.enviado_em) - instante(b.enviado_em));

// ---------------------------------------------------------------------------
// Preparação por conversa (independe do cenário)
// ---------------------------------------------------------------------------
interface Caso {
  id: string;
  canal: string;
  agora: string;
  motivo: Motivo;
  fatos: FatosPedido;
  sinais: SinalEvidencia[];
  hashes: string[];
  valorAcao: number;
  mencaoSaude: boolean;
  minutos: number;
  entregueDepois: boolean; // o pedido foi entregue depois do momento da decisão (posição final de 02/11)
}

const RE_BRINDE = /brinde|mimo|necessaire/i;

function motivoDaTag(tag: string | null, pedido: Linha | undefined, texto: string, efetivadas: number, saude: boolean): Motivo {
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

function indiceAte(t: number): Record<string, OcorrenciaHash[]> {
  const idx: Record<string, OcorrenciaHash[]> = {};
  for (const a of anexosPorData) {
    if (instante(a.enviado_em) > t) break;
    (idx[a.hash_perceptual] ??= []).push({ anexo_id: a.anexo_id, order_id: a.order_id, customer_id: a.customer_id });
  }
  return idx;
}

const FATOS_SEM_PEDIDO: FatosPedido = { statusEntrega: "aguardando_separacao", valorPedido: 0 };

function preparar(c: Linha): Caso {
  const id = String(c.conversation_id);
  const orderId = c.order_id ? String(c.order_id) : null;
  const customerId = String(c.customer_id);
  const msgs = porConversaMsg.get(id) ?? [];
  const doCliente = msgs.filter((m) => m.autor === "cliente");
  const texto = doCliente.map((m) => String(m.texto ?? "")).join(" ");
  const agora = String(doCliente.at(-1)?.timestamp ?? c.data_abertura);
  const pedido = orderId ? porPedido.get(orderId) : undefined;

  // Base só com as linhas desta conversa (montarContexto filtra por id; isto só evita varrer tudo).
  const base: Base = baseVazia({
    conversas: [c as never],
    mensagens: msgs as never,
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
  });
  const ficha = montarContexto(id, base, agora)!;
  const fatos = fatosParaPolitica(ficha, { reenvios: "oms" }) ?? FATOS_SEM_PEDIDO;
  const efetivadas = ficha.resumo.cobrancasEfetivadas.valor;
  const saude = detectarSinais(texto).saude;
  const motivo = motivoDaTag(c.tag_agente as string | null, pedido, texto, efetivadas.length, saude);

  let sinais: SinalEvidencia[] = [];
  if (MOTIVOS_EVIDENCIA.has(motivo) && ficha.pedido.valor) {
    sinais = calcularSinais({
      anexos: ficha.anexos.valor,
      pedido: ficha.pedido.valor,
      itens: ficha.itens.valor,
      customerId,
      nTrocas12m: ficha.resumo.reenviosOms12m.valor,
      indiceHash: indiceAte(instante(agora)),
      nomesCatalogo,
      dataReclamacao: String(c.data_abertura),
    }).sinais;
  }

  const valorPedido = Number(pedido?.valor ?? 0);
  let valorAcao = 0;
  if (motivo === "brinde") valorAcao = custoBrinde;
  else if (motivo === "cobranca_duplicada") {
    const v = efetivadas.filter((p) => STATUS_COBRANCA_EFETIVADA.has(p.status)).map((p) => p.valor);
    valorAcao = v.reduce((a, b) => a + b, 0) - Math.max(...v);
  } else if (["avaria", "item_faltante", "erro_personalizacao", "atraso", "rastreio", "troca_fragrancia", "cancelamento"].includes(motivo)) {
    valorAcao = valorPedido;
  }

  return {
    id,
    canal: String(c.canal),
    agora,
    motivo,
    fatos,
    sinais,
    hashes: ficha.anexos.valor.map((a) => a.hash_perceptual),
    valorAcao: Math.round(valorAcao * 100) / 100,
    mencaoSaude: saude,
    minutos: minutos.get(id) ?? 0,
    entregueDepois: pedido?.status_entrega === "entregue" && !!pedido.data_entrega && instante(String(pedido.data_entrega)) > instante(agora),
  };
}

console.log(`Preparando ${conversas.length} conversas…`);
const casos = conversas.map(preparar).sort((a, b) => instante(a.agora) - instante(b.agora));

// ---------------------------------------------------------------------------
// Simulação de um cenário
// ---------------------------------------------------------------------------
interface Resultado {
  cenario: string;
  p_sem_sinal: number;
  conversas: number;
  nivel0: number; // nível da ação
  nivel1: number;
  nivel2: number;
  pct_nivel0: number;
  pct_nivel1: number;
  pct_nivel2: number;
  aprovacao_resposta: number; // Reclame Aqui: resposta pública aprovada por pessoa
  autonomas: number; // ação no nível 0 e sem aprovação de resposta: nenhuma pessoa toca
  pct_autonomas: number;
  conversas_mes_liberadas: number;
  horas_mes_liberadas: number;
  custo_atendimento_evitado_mes_rs: number;
  reclamacoes_evidencia: number;
  reclamacoes_nivel0: number;
  perda_esperada_evidencia_mes_rs: number;
  reenvios_atraso_nivel0: number;
  reenvios_atraso_original_entregue_depois: number;
  reenvios_extravio: number;
  reenvios_extravio_original_entregue_depois: number;
  perda_reenvio_atraso_mes_rs: number;
  perda_total_mes_rs: number;
  perda_reenvio_atraso_politica_mes_rs: number; // em qualquer nível: a política manda reenviar, quem aprova também não sabe
  casos_sinal_forte: number;
  fraudes_esperadas_mes: number;
  perda_evitada_mes_rs: number;
  atrito_mes_rs: number;
  auditados: number;
  auditoria_mes_rs: number;
  saldo_liquido_mes_rs: number;
  saldo_comparavel_mes_rs: number;
  acoes_sem_teto: number;
  gasto_sem_teto_mes_rs: number;
  gasto_sem_teto_dia_p90_rs: number;
  gasto_sem_teto_dia_max_rs: number;
  casos_freados: number;
  dias_com_freio: number;
}

function percentil(v: number[], q: number): number {
  if (v.length === 0) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
}

// Causa do nível 1 da ação: o escalonador que subiu o caso ou a regra do motivo.
function causaNivel1(motivo: Motivo, justificativa: string): string {
  if (justificativa.includes("reclame_aqui.resposta_publica")) return "reclame_aqui";
  if (justificativa.includes("Freio diário")) return "freio_diario";
  if (justificativa.includes("› limites_por_papel]")) return "limite_do_atendente";
  if (justificativa.includes("acima do valor do pedido")) return "acima_do_valor_do_pedido";
  if (justificativa.includes("acima do de sinalizar")) return "custo_esperado";
  if (motivo === "cancelamento" || motivo === "troca_fragrancia") return `regra_${motivo}`;
  if (justificativa.includes("motivos fora da tabela")) return `sem_regra_${motivo}`;
  return `regra_${motivo}`;
}

const DINHEIRO = new Set(["reenviar_produto", "reimprimir_personalizacao", "reembolsar", "trocar_produto", "cancelar_pedido"]);

function simular(nome: string, base: CenarioPolitica, p0: number) {
  const bloqueados = new Set<string>();
  const cenario: CenarioPolitica = { ...base, pSemSinal: p0, hashesBloqueados: bloqueados };
  const gastoDia = new Map<string, number>(); // R$ escalados (×4) em ações sem teto, como no dia real
  const diasFreio = new Set<string>();
  const niveis = [0, 0, 0];
  const porMotivo: Record<string, number[]> = {};
  const causas: Record<string, number> = {};
  let aprovResp = 0, autonomas = 0, horas = 0, evitado = 0, perda = 0, recl = 0, recl0 = 0;
  let reenvAtraso = 0, reenvAtrasoDup = 0, perdaAtraso = 0, reenvExtravio = 0, reenvExtravioDup = 0, perdaAtrasoPolitica = 0;
  let fortes = 0, fraudes = 0, perdaEvitada = 0, atrito = 0, auditados = 0, semTeto = 0, gastoSemTeto = 0, freados = 0;

  for (const c of casos) {
    const hoje = dia(c.agora);
    const d = decidirNivel({
      motivo: c.motivo,
      confiancaClassificador: 1,
      fatos: c.fatos,
      sinais: c.sinais,
      valorAcao: c.valorAcao,
      canal: c.canal as "whatsapp" | "email" | "reclame_aqui",
      mencaoSaude: c.mencaoSaude,
      cenario,
      hashesFotos: c.hashes,
      gastoAutonomoHojeRs: gastoDia.get(hoje) ?? 0,
      chaveAmostra: c.id,
    });
    niveis[d.nivelAcao]++;
    (porMotivo[c.motivo] ??= [0, 0, 0])[d.nivelAcao]++;
    if (d.nivelAcao === 1) {
      const k = causaNivel1(c.motivo, d.justificativa);
      causas[k] = (causas[k] ?? 0) + 1;
      if (k === "freio_diario") {
        freados++;
        diasFreio.add(hoje);
      }
    }
    if (d.aprovacaoResposta) aprovResp++;
    const p = probabilidadeImprocedente(c.sinais, p0);
    if ((c.motivo === "atraso" || c.motivo === "rastreio") && d.ferramenta === "reenviar_produto" && c.entregueDepois) {
      perdaAtrasoPolitica += FATOR_CUSTO_IMPROCEDENTE * c.fatos.valorPedido;
    }
    const temForte = classificarSinais(c.sinais).fortes.length > 0;

    if (d.nivelAcao === 0) {
      if (d.auditoriaPosterior) auditados++;
      if (d.acaoSemTeto) {
        semTeto++;
        gastoSemTeto += c.valorAcao;
        gastoDia.set(hoje, (gastoDia.get(hoje) ?? 0) + c.valorAcao * FATOR_AMOSTRA);
      }
      // Reenvio por atraso no nível 0: se o original chegou depois, o reenvio foi a mais (0,45 × valor, parametros.md).
      if ((c.motivo === "atraso" || c.motivo === "rastreio") && d.ferramenta === "reenviar_produto") {
        reenvAtraso++;
        if (c.fatos.statusEntrega === "extraviado") {
          reenvExtravio++;
          if (c.entregueDepois) reenvExtravioDup++;
        }
        if (c.entregueDepois) {
          reenvAtrasoDup++;
          perdaAtraso += FATOR_CUSTO_IMPROCEDENTE * c.fatos.valorPedido;
        }
      }
      // Liberada de verdade só quando nenhuma pessoa toca (nem aprova a resposta pública).
      if (!d.aprovacaoResposta) {
        autonomas++;
        horas += c.minutos / 60;
        evitado += CUSTO_CANAL[c.canal] ?? 0;
      }
    }
    if (MOTIVOS_EVIDENCIA.has(c.motivo)) {
      recl++;
      if (d.nivelAcao === 0 && (d.ferramenta === "reenviar_produto" || d.ferramenta === "reimprimir_personalizacao")) {
        recl0++;
        perda += p * FATOR_CUSTO_IMPROCEDENTE * c.fatos.valorPedido;
      }
    }
    if (d.ferramenta === "sinalizar_suspeita") {
      atrito += (1 - p) * CUSTO_SINALIZAR_RS;
      if (temForte) {
        fortes++;
        fraudes += p;
        perdaEvitada += p * FATOR_CUSTO_IMPROCEDENTE * c.fatos.valorPedido;
      }
      // Lista de bloqueio: supõe que o supervisor confirma a foto repetida (limite superior do efeito).
      if (c.sinais.includes("hash_em_outro_pedido_ou_cliente")) for (const h of c.hashes) bloqueados.add(h);
    }
  }
  void DINHEIRO;

  const n = casos.length;
  const auditoria = auditados * CUSTO_AUDITORIA_RS;
  const m = (v: number) => Math.round(v * ESCALA_MES * 100) / 100;
  const pct = (v: number) => Math.round((v / n) * 1000) / 10;
  const gastos = [...gastoDia.values()];
  const r: Resultado = {
    cenario: nome,
    p_sem_sinal: p0,
    conversas: n,
    nivel0: niveis[0],
    nivel1: niveis[1],
    nivel2: niveis[2],
    pct_nivel0: pct(niveis[0]),
    pct_nivel1: pct(niveis[1]),
    pct_nivel2: pct(niveis[2]),
    aprovacao_resposta: aprovResp,
    autonomas,
    pct_autonomas: pct(autonomas),
    conversas_mes_liberadas: Math.round(autonomas * ESCALA_MES),
    horas_mes_liberadas: Math.round(horas * ESCALA_MES * 10) / 10,
    custo_atendimento_evitado_mes_rs: m(evitado),
    reclamacoes_evidencia: recl,
    reclamacoes_nivel0: recl0,
    perda_esperada_evidencia_mes_rs: m(perda),
    reenvios_atraso_nivel0: reenvAtraso,
    reenvios_atraso_original_entregue_depois: reenvAtrasoDup,
    reenvios_extravio: reenvExtravio,
    reenvios_extravio_original_entregue_depois: reenvExtravioDup,
    perda_reenvio_atraso_mes_rs: m(perdaAtraso),
    perda_total_mes_rs: m(perda + perdaAtraso),
    perda_reenvio_atraso_politica_mes_rs: m(perdaAtrasoPolitica),
    casos_sinal_forte: fortes,
    fraudes_esperadas_mes: Math.round(fraudes * ESCALA_MES * 10) / 10,
    perda_evitada_mes_rs: m(perdaEvitada),
    atrito_mes_rs: m(atrito),
    auditados,
    auditoria_mes_rs: m(auditoria),
    saldo_liquido_mes_rs: m(evitado - perda - perdaAtraso - atrito - auditoria),
    saldo_comparavel_mes_rs: m(evitado - perda - perdaAtrasoPolitica - atrito - auditoria),
    acoes_sem_teto: semTeto,
    gasto_sem_teto_mes_rs: m(gastoSemTeto),
    gasto_sem_teto_dia_p90_rs: Math.round(percentil(gastos, 0.9) * 100) / 100,
    gasto_sem_teto_dia_max_rs: Math.round(Math.max(0, ...gastos) * 100) / 100,
    casos_freados: freados,
    dias_com_freio: diasFreio.size,
  };
  return { r, porMotivo, causas };
}

// ---------------------------------------------------------------------------
// Cenários (cumulativos, um a um)
// ---------------------------------------------------------------------------
const c1: CenarioPolitica = { ...CENARIO_VIGENTE, nome: "1_vigente" };
const c2: CenarioPolitica = {
  ...c1,
  nome: "2_base_ajustada",
  limiteReenvioRs: 300,
  auditoriaAmostraPct: 10,
  estornoDuplicidadeSemTeto: true,
  bloquearFotosConfirmadas: true,
};
const c3: CenarioPolitica = { ...c2, nome: "3_cancelamento_antes_separacao", cancelamentoAntesSeparacaoNivel0: true };
const c4: CenarioPolitica = { ...c3, nome: "4_atraso_comprovado", atrasoComprovadoNivel0: true };
const c5: CenarioPolitica = { ...c4, nome: "5_troca_fragrancia", trocaFragranciaNivel0: true };
const c6: CenarioPolitica = { ...c5, nome: "6_reclame_aqui_separa", reclameAquiSeparaResposta: true };
const c7: CenarioPolitica = { ...c6, nome: "7_freio_3000", freioDiarioRs: 3000 };
const CENARIOS = [c1, c2, c3, c4, c5, c6, c7];

// O último cenário tem de ser o padrão de regras.ts (fora o nome).
const { nome: _n1, hashesBloqueados: _h1, ...semNome7 } = c7;
const { nome: _n2, hashesBloqueados: _h2, ...semNomePadrao } = CENARIO_PADRAO;
void _n1; void _n2; void _h1; void _h2;
if (JSON.stringify(semNome7) !== JSON.stringify(semNomePadrao)) {
  throw new Error(`cenário 7 diferente de CENARIO_PADRAO:\n${JSON.stringify(semNome7)}\n${JSON.stringify(semNomePadrao)}`);
}

const resultados: Resultado[] = [];
const motivos: Record<string, Record<string, number[]>> = {};
const causasNivel1: Record<string, Record<string, number>> = {};
for (const cen of CENARIOS) {
  for (const p0 of VALORES_P) {
    const { r, porMotivo, causas } = simular(cen.nome, cen, p0);
    resultados.push(r);
    if (p0 === 0.05) {
      motivos[cen.nome] = porMotivo;
      causasNivel1[cen.nome] = Object.fromEntries(Object.entries(causas).sort((a, b) => b[1] - a[1]));
    }
  }
}

// Ganho de cada regra somada (p = 0,05): diferença para o cenário anterior.
const em005 = CENARIOS.map((c) => resultados.find((r) => r.cenario === c.nome && r.p_sem_sinal === 0.05)!);
const ganhoIncremental = em005.slice(1).map((r, i) => {
  const ant = em005[i];
  const dif = (k: keyof Resultado) => Math.round(((r[k] as number) - (ant[k] as number)) * 100) / 100;
  return {
    cenario: r.cenario,
    delta_acao_nivel0: dif("nivel0"),
    delta_autonomas: dif("autonomas"),
    delta_pct_autonomas: dif("pct_autonomas"),
    delta_conversas_mes: dif("conversas_mes_liberadas"),
    delta_horas_mes: dif("horas_mes_liberadas"),
    delta_perda_mes_rs: dif("perda_total_mes_rs"),
    delta_saldo_mes_rs: dif("saldo_liquido_mes_rs"),
    delta_saldo_comparavel_mes_rs: dif("saldo_comparavel_mes_rs"),
  };
});

// Avaliação: saldo positivo nos três p e autonomia total.
const avaliacao = CENARIOS.map((c) => {
  const rs = resultados.filter((r) => r.cenario === c.nome);
  return {
    nome: c.nome,
    pct_autonomas_p005: rs.find((r) => r.p_sem_sinal === 0.05)!.pct_autonomas,
    pct_acao_nivel0_p005: rs.find((r) => r.p_sem_sinal === 0.05)!.pct_nivel0,
    saldo_minimo_mes_rs: Math.min(...rs.map((r) => r.saldo_liquido_mes_rs)),
    saldo_comparavel_minimo_mes_rs: Math.min(...rs.map((r) => r.saldo_comparavel_mes_rs)),
    positivo_em_todos: rs.every((r) => r.saldo_liquido_mes_rs > 0),
  };
});

// ---------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------
mkdirSync(OUT, { recursive: true });
const colunas = Object.keys(resultados[0]) as (keyof Resultado)[];
writeFileSync(
  path.join(OUT, "simulacao_autonomia.csv"),
  [colunas.join(","), ...resultados.map((r) => colunas.map((k) => r[k]).join(","))].join("\n") + "\n",
);
const contagemMotivos: Record<string, number> = {};
for (const c of casos) contagemMotivos[c.motivo] = (contagemMotivos[c.motivo] ?? 0) + 1;
writeFileSync(
  path.join(OUT, "simulacao_autonomia.json"),
  JSON.stringify(
    {
      gerado_por: "app/scripts/simular-autonomia.ts",
      escala: { fator_amostra: FATOR_AMOSTRA, meses: MESES, observacao: "valores por mês = amostra × 4 ÷ 3" },
      parametros: {
        custo_por_conversa_rs: CUSTO_CANAL,
        fator_custo_improcedente: FATOR_CUSTO_IMPROCEDENTE,
        custo_sinalizar_rs: CUSTO_SINALIZAR_RS,
        custo_auditoria_rs: CUSTO_AUDITORIA_RS,
        custo_brinde_rs: custoBrinde,
        p_sem_sinal_testados: VALORES_P,
        freio_teto_rs: 3000,
      },
      cenarios: CENARIOS.map(({ hashesBloqueados: _h, ...c }) => (void _h, c)),
      definicoes: {
        nivel_acao: "nível da ação que o agente executa (decidirNivel.nivelAcao)",
        aprovacao_resposta: "Reclame Aqui: a resposta pública precisa de aprovação, mesmo com a ação no nível 0",
        autonomas: "ação no nível 0 e sem aprovação de resposta: nenhuma pessoa toca na conversa",
        custo_atendimento_evitado: "custo por conversa do canal (parametros.md) das conversas autônomas",
        perda_esperada_evidencia: "soma de p × 0,45 × valor do pedido das reclamações com evidência resolvidas no nível 0",
        perda_reenvio_atraso: "0,45 × valor do pedido nos reenvios por atraso no nível 0 cujo pedido original foi entregue depois (medido)",
        atrito: "(1 − p) × R$ 6 por caso sinalizado ao supervisor",
        auditoria: "R$ 6 por caso de nível 0 sorteado",
        saldo_liquido: "custo evitado − perda esperada (evidência) − perda de reenvio por atraso no nível 0 − atrito − auditoria",
        saldo_comparavel: "igual ao saldo líquido, mas com a perda de reenvio por atraso em qualquer nível (a política manda reenviar também no nível 1): compara cenários sem atribuir à autonomia um custo que é da política",
        perda_reenvio_atraso_politica: "0,45 × valor do pedido nos reenvios por atraso (qualquer nível) cujo original foi entregue depois",
        perda_evitada: "informativa, fora do saldo: p × 0,45 × valor dos casos com sinal forte",
      },
      limitacoes: [
        "motivo = tag_agente mapeada (rótulo humano), não a saída do classificador; confiança 1,0",
        "conversa sem tag (só bot) = nível 1",
        "pedido reconstruído na data da última mensagem do cliente",
        "reenvios do cliente contados no OMS nos 365 dias anteriores",
        "lista de fotos bloqueadas supõe que o supervisor confirma toda foto repetida sinalizada (limite superior)",
        "p é hipótese; por isso a sensibilidade em 0,02, 0,05 e 0,10",
        "níveis 1 e 2 e conversas do Reclame Aqui com resposta aprovada não contam economia",
        "atraso: supõe que o cliente escolhe o reenvio; se escolher reembolso e o original chegar, a perda é o valor do pedido",
        "cancelamento antes da separação e troca com conferência do CD: sem perda modelada (nada foi enviado / o CD confere antes)",
      ],
      motivos_amostra: contagemMotivos,
      niveis_acao_por_motivo_p005: motivos,
      causas_nivel1_p005: causasNivel1,
      ganho_incremental_p005: ganhoIncremental,
      avaliacao,
      resultados,
    },
    null,
    2,
  ) + "\n",
);

// Tabela no terminal
const t = (v: number | string, w: number) => String(v).padStart(w);
console.log(
  `\n${"cenário".padEnd(32)}${t("p0", 5)}${t("açãoN0", 8)}${t("%N1", 6)}${t("%N2", 5)}${t("%auto", 7)}${t("conv/mês", 9)}${t("h/mês", 7)}${t("evitado", 9)}${t("perda", 7)}${t("audit.", 7)}${t("saldo", 8)}${t("s.comp", 8)}${t("freados", 8)}`,
);
for (const r of resultados) {
  console.log(
    `${r.cenario.padEnd(32)}${t(r.p_sem_sinal, 5)}${t(r.pct_nivel0, 8)}${t(r.pct_nivel1, 6)}${t(r.pct_nivel2, 5)}${t(r.pct_autonomas, 7)}${t(r.conversas_mes_liberadas, 9)}${t(r.horas_mes_liberadas, 7)}${t(r.custo_atendimento_evitado_mes_rs.toFixed(0), 9)}${t(r.perda_total_mes_rs.toFixed(0), 7)}${t(r.auditoria_mes_rs.toFixed(0), 7)}${t(r.saldo_liquido_mes_rs.toFixed(0), 8)}${t(r.saldo_comparavel_mes_rs.toFixed(0), 8)}${t(r.casos_freados, 8)}`,
  );
}
console.log("\nGanho de cada regra somada (p = 0,05):");
console.table(ganhoIncremental);
console.log("Causas do nível 1 da ação (padrão, p = 0,05):", causasNivel1[c7.nome]);
const p7 = em005.at(-1)!;
console.log(
  `Sem teto no padrão: ${p7.acoes_sem_teto} ações na amostra, R$ ${p7.gasto_sem_teto_mes_rs}/mês; dia p90 R$ ${p7.gasto_sem_teto_dia_p90_rs}, máx R$ ${p7.gasto_sem_teto_dia_max_rs}; freio atuou em ${p7.dias_com_freio} dias (${p7.casos_freados} casos).`,
);
console.log(`Reenvios por atraso no nível 0: ${p7.reenvios_atraso_nivel0}; original entregue depois: ${p7.reenvios_atraso_original_entregue_depois} (R$ ${p7.perda_reenvio_atraso_mes_rs}/mês); por extravio: ${p7.reenvios_extravio} (entregue depois: ${p7.reenvios_extravio_original_entregue_depois}).`);
console.log(`\nGravado em ${OUT}/simulacao_autonomia.{json,csv}`);
