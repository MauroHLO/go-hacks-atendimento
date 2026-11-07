// Simulação de autonomia (docs/decisoes.md, seção 4).
// Passa as 2.984 conversas do histórico pelo motor REAL (lib/contexto, lib/evidencias, lib/policy) em
// vários cenários de política e mede autonomia, horas liberadas, perda esperada, atrito e auditoria.
// Lê data/raw/atendimento localmente (fora do Git) e grava só agregados em data/processed/.
//
// Uso (em app/): npm run simular
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
  } else if (["avaria", "item_faltante", "erro_personalizacao", "atraso", "troca_fragrancia", "cancelamento"].includes(motivo)) {
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
  nivel0: number;
  nivel1: number;
  nivel2: number;
  pct_nivel0: number;
  pct_nivel1: number;
  pct_nivel2: number;
  conversas_mes_liberadas: number;
  horas_mes_liberadas: number;
  custo_atendimento_evitado_mes_rs: number;
  reclamacoes_evidencia: number;
  reclamacoes_nivel0: number;
  perda_esperada_mes_rs: number;
  casos_sinal_forte: number;
  fraudes_esperadas_mes: number;
  perda_evitada_mes_rs: number;
  atrito_mes_rs: number;
  auditados: number;
  auditoria_mes_rs: number;
  saldo_liquido_mes_rs: number;
  gasto_autonomo_dia_p90_rs: number;
}

function percentil(v: number[], q: number): number {
  if (v.length === 0) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
}

// Causa do nível 1: o escalonador que subiu o caso (Reclame Aqui, limite, freio) ou a regra do motivo.
function causaNivel1(motivo: Motivo, justificativa: string): string {
  if (justificativa.includes("reclame_aqui.resposta_publica")) return "reclame_aqui";
  if (justificativa.includes("seção 4 (cenário: freio")) return "freio_diario";
  if (justificativa.includes("› limites_por_papel]")) return "limite_do_atendente";
  if (justificativa.includes("acima do de sinalizar")) return "custo_esperado";
  if (motivo === "cancelamento" || motivo === "troca_fragrancia") return `${motivo}_sempre_nivel1`;
  if (justificativa.includes("motivos fora da tabela")) return `sem_regra_${motivo}`;
  return `regra_${motivo}`;
}

function simular(nome: string, base: CenarioPolitica, p0: number): { r: Resultado; porMotivo: Record<string, number[]>; causas: Record<string, number> } {
  const bloqueados = new Set<string>();
  const cenario: CenarioPolitica = { ...base, pSemSinal: p0, hashesBloqueados: bloqueados };
  const gastoDia = new Map<string, number>(); // R$ escalados (×4), como no dia real
  const niveis = [0, 0, 0];
  const porMotivo: Record<string, number[]> = {};
  const causas: Record<string, number> = {};
  let horas = 0, evitado = 0, perda = 0, recl = 0, recl0 = 0, fortes = 0, fraudes = 0, perdaEvitada = 0, atrito = 0, auditados = 0;

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
    niveis[d.nivel]++;
    (porMotivo[c.motivo] ??= [0, 0, 0])[d.nivel]++;
    if (d.nivel === 1) {
      const k = causaNivel1(c.motivo, d.justificativa);
      causas[k] = (causas[k] ?? 0) + 1;
    }
    const p = probabilidadeImprocedente(c.sinais, p0);
    const temForte = classificarSinais(c.sinais).fortes.length > 0;

    if (d.nivel === 0) {
      horas += c.minutos / 60;
      evitado += CUSTO_CANAL[c.canal] ?? 0;
      if (d.auditoriaPosterior) auditados++;
      const comDinheiro = ["reenviar_produto", "reimprimir_personalizacao", "reembolsar", "trocar_produto"].includes(d.ferramenta);
      if (comDinheiro) gastoDia.set(hoje, (gastoDia.get(hoje) ?? 0) + c.valorAcao * FATOR_AMOSTRA);
    }
    if (MOTIVOS_EVIDENCIA.has(c.motivo)) {
      recl++;
      const executa = d.nivel === 0 && (d.ferramenta === "reenviar_produto" || d.ferramenta === "reimprimir_personalizacao");
      if (executa) {
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

  const n = casos.length;
  const auditoria = auditados * CUSTO_AUDITORIA_RS;
  const m = (v: number) => Math.round(v * ESCALA_MES * 100) / 100;
  const r: Resultado = {
    cenario: nome,
    p_sem_sinal: p0,
    conversas: n,
    nivel0: niveis[0],
    nivel1: niveis[1],
    nivel2: niveis[2],
    pct_nivel0: Math.round((niveis[0] / n) * 1000) / 10,
    pct_nivel1: Math.round((niveis[1] / n) * 1000) / 10,
    pct_nivel2: Math.round((niveis[2] / n) * 1000) / 10,
    conversas_mes_liberadas: Math.round(niveis[0] * ESCALA_MES),
    horas_mes_liberadas: Math.round(horas * ESCALA_MES * 10) / 10,
    custo_atendimento_evitado_mes_rs: m(evitado),
    reclamacoes_evidencia: recl,
    reclamacoes_nivel0: recl0,
    perda_esperada_mes_rs: m(perda),
    casos_sinal_forte: fortes,
    fraudes_esperadas_mes: Math.round(fraudes * ESCALA_MES * 10) / 10,
    perda_evitada_mes_rs: m(perdaEvitada),
    atrito_mes_rs: m(atrito),
    auditados,
    auditoria_mes_rs: m(auditoria),
    saldo_liquido_mes_rs: m(evitado - perda - atrito - auditoria),
    gasto_autonomo_dia_p90_rs: Math.round(percentil([...gastoDia.values()], 0.9) * 100) / 100,
  };
  return { r, porMotivo, causas };
}

// ---------------------------------------------------------------------------
// Cenários (cumulativos)
// ---------------------------------------------------------------------------
const c1: CenarioPolitica = { ...CENARIO_VIGENTE, nome: "1_vigente" };
const c2: CenarioPolitica = { ...c1, nome: "2_auditoria_10pct", auditoriaAmostraPct: 10 };
const c3: CenarioPolitica = { ...c2, nome: "3_estorno_sem_teto", estornoDuplicidadeSemTeto: true };
const c4: CenarioPolitica = { ...c3, nome: "4_brinde_sem_foto", brindeSemFoto: true };
const c5: CenarioPolitica = { ...c4, nome: "5_fotos_bloqueadas", bloquearFotosConfirmadas: true };
const c6a: CenarioPolitica = { ...c5, nome: "6a_limite_300", limiteReenvioRs: 300 };
const c6b: CenarioPolitica = { ...c5, nome: "6b_limite_500", limiteReenvioRs: 500 };
// Freio: teto medido = p90 do gasto autônomo diário (escalado ×4) do cenário 6b com p = 0,05, em centenas.
const tetoMedido = simular("pre_6b", c6b, 0.05).r.gasto_autonomo_dia_p90_rs;
const teto = Math.max(100, Math.round(tetoMedido / 100) * 100);
const c7: CenarioPolitica = { ...c6b, nome: `7_freio_${teto}`, freioDiarioRs: teto };
const CENARIOS = [c1, c2, c3, c4, c5, c6a, c6b, c7];

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

// Efeito isolado de cada alavanca sobre o vigente (p = 0,05), para separar o que ajuda do que atrapalha.
const ALAVANCAS: [string, Partial<CenarioPolitica>][] = [
  ["auditoria_10pct", { auditoriaAmostraPct: 10 }],
  ["estorno_sem_teto", { estornoDuplicidadeSemTeto: true }],
  ["brinde_sem_foto", { brindeSemFoto: true }],
  ["fotos_bloqueadas", { bloquearFotosConfirmadas: true }],
  ["limite_300", { limiteReenvioRs: 300 }],
  ["limite_500", { limiteReenvioRs: 500 }],
  [`freio_${teto}`, { freioDiarioRs: teto }],
];
const refVigente = resultados.find((r) => r.cenario === c1.nome && r.p_sem_sinal === 0.05)!;
const efeitoIsolado = ALAVANCAS.map(([nome, delta]) => {
  const r = simular(nome, { ...c1, ...delta, nome }, 0.05).r;
  return {
    alavanca: nome,
    delta_nivel0: r.nivel0 - refVigente.nivel0,
    delta_pct_nivel0: Math.round((r.pct_nivel0 - refVigente.pct_nivel0) * 10) / 10,
    delta_saldo_mes_rs: Math.round((r.saldo_liquido_mes_rs - refVigente.saldo_liquido_mes_rs) * 100) / 100,
    delta_perda_mes_rs: Math.round((r.perda_esperada_mes_rs - refVigente.perda_esperada_mes_rs) * 100) / 100,
  };
});

// Recomendado: maior % de nível 0 (p = 0,05) com saldo líquido positivo nos três valores de p.
// Empate: maior autonomia média nos três p.
const porCenario = CENARIOS.map((c) => {
  const rs = resultados.filter((r) => r.cenario === c.nome);
  const media = rs.reduce((a, r) => a + r.pct_nivel0, 0) / rs.length;
  return {
    nome: c.nome,
    autonomia: rs.find((r) => r.p_sem_sinal === 0.05)!.pct_nivel0,
    autonomiaMedia: Math.round(media * 100) / 100,
    saldoMinimo: Math.min(...rs.map((r) => r.saldo_liquido_mes_rs)),
    positivoEmTodos: rs.every((r) => r.saldo_liquido_mes_rs > 0),
  };
});
const recomendado =
  porCenario.filter((c) => c.positivoEmTodos).sort((a, b) => b.autonomia - a.autonomia || b.autonomiaMedia - a.autonomiaMedia)[0] ?? null;

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
        freio_teto_rs: teto,
        freio_origem: `p90 do gasto autônomo diário (×4) no cenário 6b com p = 0,05: R$ ${tetoMedido}`,
      },
      definicoes: {
        custo_atendimento_evitado: "custo por conversa do canal (parametros.md) das conversas de nível 0",
        perda_esperada: "soma de p × 0,45 × valor do pedido das reclamações com evidência resolvidas no nível 0",
        atrito: "(1 − p) × R$ 6 por caso sinalizado ao supervisor",
        auditoria: "R$ 6 por caso de nível 0 sorteado",
        saldo_liquido: "custo evitado − perda esperada − atrito − auditoria",
        perda_evitada: "informativa, fora do saldo: p × 0,45 × valor dos casos com sinal forte",
      },
      limitacoes: [
        "motivo = tag_agente mapeada (rótulo humano), não a saída do classificador; confiança 1,0",
        "conversa sem tag (só bot) = nível 1",
        "pedido reconstruído na data da última mensagem do cliente",
        "reenvios do cliente contados no OMS nos 365 dias anteriores",
        "lista de fotos bloqueadas supõe que o supervisor confirma toda foto repetida sinalizada (limite superior)",
        "p é hipótese; por isso a sensibilidade em 0,02, 0,05 e 0,10",
        "níveis 1 e 2 não contam economia, mesmo quando o agente prepara o caso",
      ],
      motivos_amostra: contagemMotivos,
      niveis_por_motivo_p005: motivos,
      causas_nivel1_p005: causasNivel1,
      efeito_isolado_p005: efeitoIsolado,
      resultados,
      recomendado,
      avaliacao: porCenario,
    },
    null,
    2,
  ) + "\n",
);

// Tabela no terminal
const t = (v: number | string, w: number) => String(v).padStart(w);
console.log(
  `\n${"cenário".padEnd(20)}${t("p0", 6)}${t("%N0", 7)}${t("%N1", 7)}${t("%N2", 7)}${t("conv/mês", 10)}${t("h/mês", 8)}${t("evitado", 10)}${t("perda", 9)}${t("atrito", 8)}${t("audit.", 8)}${t("saldo", 10)}${t("fraudes", 9)}`,
);
for (const r of resultados) {
  console.log(
    `${r.cenario.padEnd(20)}${t(r.p_sem_sinal, 6)}${t(r.pct_nivel0, 7)}${t(r.pct_nivel1, 7)}${t(r.pct_nivel2, 7)}${t(r.conversas_mes_liberadas, 10)}${t(r.horas_mes_liberadas, 8)}${t(r.custo_atendimento_evitado_mes_rs.toFixed(0), 10)}${t(r.perda_esperada_mes_rs.toFixed(0), 9)}${t(r.atrito_mes_rs.toFixed(0), 8)}${t(r.auditoria_mes_rs.toFixed(0), 8)}${t(r.saldo_liquido_mes_rs.toFixed(0), 10)}${t(r.fraudes_esperadas_mes, 9)}`,
  );
}
console.log("\nMotivos (amostra):", contagemMotivos);
console.log("Efeito isolado de cada alavanca (sobre o vigente, p = 0,05):");
console.table(efeitoIsolado);
console.log("Causas do nível 1 (vigente, p = 0,05):", causasNivel1["1_vigente"]);
console.log(`Freio: teto R$ ${teto} (medido: R$ ${tetoMedido})`);
console.log("Recomendado:", recomendado);
console.log(`\nGravado em ${OUT}/simulacao_autonomia.{json,csv}`);
