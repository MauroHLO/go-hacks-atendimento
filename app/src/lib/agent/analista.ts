// Agente analista proativo (docs/decisoes.md, seção 6).
// detectarIncidentes(): lê os agregados de causa-raiz (data/processed, exportados para app/src/dados/agregados.json),
// abre incidente (abrir_incidente) quando a regra mede um desvio e prepara avisos proativos (notificar_clientes)
// para os pedidos ainda abertos afetados, respeitando o consentimento do CRM e o máximo de 300 por dia.
// Regras (dados medidos, não opinião):
// - transportadora × UF: recontato >= 2× o das demais transportadoras, com pelo menos 30 conversas;
// - brinde da campanha: >= 25% das conversas dos pedidos com brinde são "Produto faltando".
// Os textos dos avisos não prometem prazo nem solução.

import agregadosJson from "../../dados/agregados.json";
import afetadosJson from "../../dados/pedidos_afetados.json";
import { dia } from "../dados";
import { MAX_NOTIFICACOES_DIA } from "../policy";
import { FERRAMENTAS, Simulador, type RegistroAcao } from "../ferramentas";

export const FATOR_DESVIO_RECONTATO = 2;
export const MIN_CONVERSAS_RECORTE = 30;
export const LIMIAR_BRINDE_FALTANDO = 0.25;

export interface Agregados {
  recontato_transportadora_uf: { transportadora: string; uf: string; conversas: number; pct_recontato: number }[];
  pct_recontato_demais_transportadoras: number;
  brinde: { conversas: number; conversas_produto_faltando: number; pedidos_com_brinde_e_conversa: number };
}

export interface PedidoAfetado {
  order_id: string;
  customer_id: string;
  transportadora: string;
  uf: string;
  status_entrega: string;
  data_prometida: string | null;
  tem_brinde: boolean;
  aceita_comunicacao_whatsapp: string | null;
  aceita_comunicacao_email: string | null;
}

export const AGREGADOS = agregadosJson as unknown as Agregados;
export const PEDIDOS_AFETADOS = afetadosJson as PedidoAfetado[];

export const AVISO = {
  atraso_transportadora: (t: string) =>
    `Olá! Identificamos atraso nas entregas da ${t} na sua região e já abrimos um incidente com a transportadora. Você pode acompanhar o pedido pelo código de rastreio.`,
  brinde_campanha: () =>
    "Olá! Seu pedido participa da campanha Mimo de Outubro e deve trazer a Necessaire GoBeauté de brinde. Se ela não vier na caixa, responda esta mensagem com uma foto.",
} as const;

export interface Incidente {
  tipo: "transportadora_uf" | "brinde_campanha";
  escopo: string;
  evidencias: string[];
  referencia: string | null; // INC-SIM-…
  pedidosAfetados: number; // abertos, na base
  semConsentimento: number;
  avisos: { dia: string; pedidos: number; executado: boolean; referencia: string | null }[];
}

export interface ResultadoAnalista {
  incidentes: Incidente[];
  log: RegistroAcao[];
}

function temConsentimento(p: PedidoAfetado): boolean {
  return p.aceita_comunicacao_whatsapp === "sim" || p.aceita_comunicacao_email === "sim";
}

function proximoDia(d: string, n: number): string {
  const t = Date.parse(`${d}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export interface OpcoesAnalista {
  sim?: Simulador; // papel analista
  agregados?: Agregados;
  afetados?: readonly PedidoAfetado[];
}

export function detectarIncidentes(o: OpcoesAnalista = {}): ResultadoAnalista {
  const sim = o.sim ?? new Simulador({ papel: "analista" });
  const ag = o.agregados ?? AGREGADOS;
  const afetados = o.afetados ?? PEDIDOS_AFETADOS;
  const inicioLog = sim.log.length;
  const incidentes: Incidente[] = [];
  const jaAvisados = new Set<string>();
  // Avisos são distribuídos por dia a partir de hoje, no máximo 300 por dia somando todos os incidentes.
  const usadosPorDia = new Map<string, number>();
  const hoje = dia(sim.agora());

  function avisar(pedidos: PedidoAfetado[], tipo: string, texto: string): Incidente["avisos"] {
    const lista = pedidos.filter((p) => !jaAvisados.has(p.order_id)).map((p) => p.order_id);
    lista.forEach((id) => jaAvisados.add(id));
    const avisos: Incidente["avisos"] = [];
    let n = 0;
    let i = 0;
    while (i < lista.length) {
      const d = proximoDia(hoje, n++);
      const livres = MAX_NOTIFICACOES_DIA - (usadosPorDia.get(d) ?? 0);
      if (livres <= 0) continue;
      const lote = lista.slice(i, i + livres);
      i += lote.length;
      usadosPorDia.set(d, (usadosPorDia.get(d) ?? 0) + lote.length);
      // Hoje executa (simulado); os dias seguintes ficam preparados.
      if (d === hoje) {
        const r = FERRAMENTAS.notificar_clientes(sim, { order_ids: lote, tipo_aviso: tipo, texto });
        avisos.push({ dia: d, pedidos: lote.length, executado: r.ok, referencia: r.ok ? (r.registro?.referencia_sistema ?? null) : null });
      } else {
        avisos.push({ dia: d, pedidos: lote.length, executado: false, referencia: null });
      }
    }
    return avisos;
  }

  // 1. Transportadora × UF
  const limiar = FATOR_DESVIO_RECONTATO * ag.pct_recontato_demais_transportadoras;
  const porTransp = new Map<string, Agregados["recontato_transportadora_uf"]>();
  for (const r of ag.recontato_transportadora_uf) {
    if (r.conversas >= MIN_CONVERSAS_RECORTE && r.pct_recontato >= limiar) {
      porTransp.set(r.transportadora, [...(porTransp.get(r.transportadora) ?? []), r]);
    }
  }
  for (const [transp, ufs] of porTransp) {
    const lista = ufs.map((u) => u.uf);
    const evidencias = [
      ...ufs.map((u) => `${transp} × ${u.uf}: ${u.pct_recontato}% de recontato em ${u.conversas} conversas (amostra 1 em 4)`),
      `limiar: ${FATOR_DESVIO_RECONTATO}× o recontato das demais transportadoras (${ag.pct_recontato_demais_transportadoras}%)`,
    ];
    const r = FERRAMENTAS.abrir_incidente(sim, { tipo: "transportadora_uf", escopo: `${transp}: ${lista.join(", ")}`, evidencias });
    const abertos = afetados.filter((p) => p.transportadora === transp && lista.includes(p.uf));
    const comConsent = abertos.filter(temConsentimento);
    incidentes.push({
      tipo: "transportadora_uf",
      escopo: `${transp}: ${lista.join(", ")}`,
      evidencias,
      referencia: r.ok ? (r.registro?.referencia_sistema ?? null) : null,
      pedidosAfetados: abertos.length,
      semConsentimento: abertos.length - comConsent.length,
      avisos: avisar(comConsent, "atraso_transportadora", AVISO.atraso_transportadora(transp)),
    });
  }

  // 2. Brinde da campanha
  const b = ag.brinde;
  const share = b.conversas > 0 ? b.conversas_produto_faltando / b.conversas : 0;
  if (share >= LIMIAR_BRINDE_FALTANDO) {
    const naFila = sim.base.conversas.filter((c) => /brinde/i.test(c.assunto ?? "")).length;
    const evidencias = [
      `${b.conversas_produto_faltando} de ${b.conversas} conversas (${Math.round(share * 100)}%) dos pedidos com brinde são "Produto faltando" (amostra 1 em 4)`,
      `${naFila} conversas na fila de 02/11 com assunto sobre brinde`,
      `limiar: ${Math.round(LIMIAR_BRINDE_FALTANDO * 100)}% das conversas desses pedidos`,
    ];
    const r = FERRAMENTAS.abrir_incidente(sim, { tipo: "brinde_campanha", escopo: "Mimo de Outubro GoBeauté: brinde não enviado", evidencias });
    const abertos = afetados.filter((p) => p.tem_brinde);
    const comConsent = abertos.filter(temConsentimento);
    incidentes.push({
      tipo: "brinde_campanha",
      escopo: "Mimo de Outubro GoBeauté: brinde não enviado",
      evidencias,
      referencia: r.ok ? (r.registro?.referencia_sistema ?? null) : null,
      pedidosAfetados: abertos.length,
      semConsentimento: abertos.length - comConsent.length,
      avisos: avisar(comConsent, "brinde_campanha", AVISO.brinde_campanha()),
    });
  }

  return { incidentes, log: sim.log.slice(inicioLog) };
}
