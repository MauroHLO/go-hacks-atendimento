// Orquestrador de ponta a ponta (docs/decisoes.md, seção 6).
// ler_conversa → consultar_pedido / consultar_cliente → ver_anexos → classificar (Jev) → verificar_pagamento
// (se o motivo for financeiro) → evidências → decidirNivel → ação (nível 0 executa; nível 1 solicitar_aprovacao;
// nível 2 sinalizar_suspeita / orientar_suspensao_uso / acionar_pessoa) → redigir → responder_cliente (ou
// rascunho para aprovação) → encerrar_conversa quando aplicável.
// O modelo classifica e redige; quem decide nível e ação é lib/policy. Cada passo vai para o log do Simulador.

import { fatosParaPolitica, montarContexto, STATUS_COBRANCA_EFETIVADA, type Ficha } from "../contexto";
import { dia } from "../dados";
import { calcularSinais, type ResultadoEvidencias } from "../evidencias";
import { FERRAMENTAS, type RegistroAcao, type Resultado, type Simulador } from "../ferramentas";
import {
  decidirNivel,
  MENSAGEM_EM_ANALISE,
  REGRAS,
  type DecisaoPolitica,
  type FatosPedido,
  type Motivo,
  type Nivel,
} from "../policy";
import type { ClienteIA } from "./cliente";
import { classificar, type Classificacao } from "./classificador";
import { TEXTO_RESERVA } from "./checagem";
import { redigir, type ResultadoRedacao } from "./redator";

const MOTIVOS_EVIDENCIA: ReadonlySet<Motivo> = new Set(["avaria", "item_faltante", "brinde", "erro_personalizacao"]);
const MOTIVOS_FINANCEIROS: ReadonlySet<Motivo> = new Set(["cobranca_duplicada", "pagamento_pendente"]);
// produtos.csv: campos da ficha que podem responder dúvida de produto.
const CAMPOS_FICHA = [
  "apresentacao", "conteudo", "modelo_compativel", "compativel_magsafe", "composicao", "modo_de_uso", "notas_olfativas",
  "fixacao", "advertencias", "validade_meses_fechado", "validade_apos_aberto", "vegano", "cruelty_free",
  "sem_gluten_sem_lactose", "liberado_low_poo", "registro_anvisa", "tipo_personalizacao", "prazo_producao_dias_uteis",
] as const;
const RE_PREFERE_REEMBOLSO =/reembols|estorn|dinheiro de volta|devolu[cç][aã]o do (valor|dinheiro)/i;

export interface EstadoOrquestrador {
  gastoSemTetoPorDia: Map<string, number>; // R$ de ações sem teto executadas no nível 0 (freio diário)
}

export function novoEstado(): EstadoOrquestrador {
  return { gastoSemTetoPorDia: new Map() };
}

export interface DepsOrquestrador {
  sim: Simulador;
  ia: ClienteIA;
  estado?: EstadoOrquestrador;
  agora?: string; // padrão: sim.agora()
  relogio?: () => number; // ms, para telemetria
}

export interface DecisaoFinal extends DecisaoPolitica {
  motivo: Motivo;
  nivelFinal: Nivel; // depois da execução e da redação (falhas sobem o nível)
  ajustes: string[];
}

export interface ResultadoProcessamento {
  conversation_id: string;
  classificacao: Classificacao;
  ficha: Ficha;
  sinais: ResultadoEvidencias | null;
  decisao: DecisaoFinal;
  acoes: { ferramenta: string; ok: boolean; erro?: string }[];
  log: RegistroAcao[];
  resposta: {
    texto: string;
    enviada: boolean;
    paraAprovacao: boolean;
    reserva: boolean;
    tentativas: number;
    falhasChecagem: string[][];
  };
  telemetria: {
    ms: number;
    jev: { ms: number; tokensEntrada: number; tokensSaida: number; custoUsd: number | null };
    chat: { ms: number; tokensEntrada: number; tokensSaida: number; custoUsd: number | null };
    custoUsdEstimado: number; // Jev (o proxy não informa custo do chat)
    sistemasAcessados: number;
  };
}

// ---------- formatação de fatos (sem dados pessoais) ----------
function dataBr(d: string | null | undefined): string | null {
  if (!d) return null;
  const [a, m, di] = d.slice(0, 10).split("-");
  return `${di}/${m}/${a}`;
}
function reais(v: number): string {
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}
const STATUS_TXT: Record<string, string> = {
  aguardando_separacao: "aguardando separação",
  em_transito: "em trânsito",
  entregue: "entregue",
  extraviado: "extraviado",
  devolvido: "devolvido",
  cancelado: "cancelado",
};

export function fatosTexto(ficha: Ficha): string[] {
  const p = ficha.pedido.valor;
  if (!p) return ["Conversa sem pedido associado."];
  const r = ficha.resumo;
  const f = [
    `Pedido ${p.order_id} (${p.marca}), valor ${reais(p.valor)}.`,
    `Produto: ${p.descricao_produto}.`,
    `Status: ${STATUS_TXT[p.status_entrega] ?? p.status_entrega}; transportadora ${p.transportadora}.`,
  ];
  if (p.data_prometida) f.push(`Data prometida de entrega: ${dataBr(p.data_prometida)}.`);
  if (p.data_entrega) f.push(`Entregue em ${dataBr(p.data_entrega)}.`);
  const ult = r.ultimoEventoRastreio.valor;
  if (ult) {
    f.push(`Último evento do rastreio: ${ult.status.replaceAll("_", " ")} em ${dataBr(ult.data_hora_evento)}.`);
    if (ult.previsao_entrega && !p.data_entrega) f.push(`Previsão da transportadora: ${dataBr(ult.previsao_entrega)}.`);
  }
  return f;
}

// ---------- valor da ação (mesma regra da simulação) ----------
export function valorDaAcao(motivo: Motivo, ficha: Ficha, custoBrinde: number): number {
  const p = ficha.pedido.valor;
  if (!p) return 0;
  if (motivo === "brinde") return custoBrinde;
  if (motivo === "cobranca_duplicada") {
    const v = ficha.resumo.cobrancasEfetivadas.valor.filter((x) => STATUS_COBRANCA_EFETIVADA.has(x.status)).map((x) => x.valor);
    return v.length > 1 ? Math.round((v.reduce((a, b) => a + b, 0) - Math.max(...v)) * 100) / 100 : 0;
  }
  if (["avaria", "item_faltante", "erro_personalizacao", "atraso", "rastreio", "troca_fragrancia", "cancelamento"].includes(motivo)) return p.valor;
  return 0;
}

// ---------- descrição da ação para o redator ----------
function descreverAcao(d: DecisaoPolitica, executada: boolean, ficha: Ficha, valor: number, extra: string | null): string {
  const p = ficha.pedido.valor;
  const transp = p?.transportadora ?? "transportadora";
  if (!executada) {
    if (d.ferramenta === "orientar_suspensao_uso" || d.ferramenta === "registrar_cosmetovigilancia") {
      return "Orientar o cliente a parar de usar o produto e procurar atendimento médico se precisar. Uma pessoa da equipe de qualidade vai cuidar do caso.";
    }
    return `A solicitação (${d.acao.replaceAll("_", " ")}) depende de análise de uma pessoa da equipe antes de qualquer providência.`;
  }
  switch (d.ferramenta) {
    case "informar_status":
      return "Informar o status do pedido, a transportadora e a previsão que estão nos FATOS.";
    case "abrir_chamado_transportadora":
      return extra ?? `Abrimos um chamado com a ${transp} sobre a entrega do pedido.`;
    case "reenviar_produto":
      return `Reenvio do produto sem custo para o cliente (pedido ${p?.order_id}).`;
    case "reimprimir_personalizacao":
      return `Nova produção do item personalizado sem custo para o cliente (pedido ${p?.order_id}).`;
    case "reembolsar":
      return `Reembolso de ${reais(valor)} referente ao pedido ${p?.order_id}.`;
    case "cancelar_pedido":
      return `Cancelamento do pedido ${p?.order_id} com reembolso integral de ${reais(valor)}.`;
    case "trocar_produto":
      return "Troca com coleta reversa: o produto novo é enviado depois que o centro de distribuição conferir a devolução.";
    case "alterar_endereco":
      return "Alteração do endereço de entrega conforme informado pelo cliente.";
    case "negar_por_politica":
      return `Explicar com cordialidade que a solicitação não se enquadra na política: ${politicaCitada(d)}`;
    case "solicitar_foto":
      return "Pedir ao cliente uma foto do produto e da embalagem para seguir com a solicitação.";
    case "validar_cupom":
      return extra ?? "Informar o resultado da validação do cupom.";
    case "verificar_pagamento":
      return extra ?? "Informar a situação do pagamento.";
    case "responder_duvida":
      return extra ?? "Responder a dúvida com as informações da ficha do produto.";
    case "agradecer":
      return "Agradecer o elogio.";
    default:
      return "Responder ao cliente com os fatos do pedido.";
  }
}

function politicaCitada(d: DecisaoPolitica): string {
  const regra = Object.values(REGRAS).find((r) => d.justificativa.includes(r.origem));
  return regra?.texto ?? "a política de atendimento.";
}

// ---------- execução ----------
type Chamada = (nome: keyof typeof FERRAMENTAS, params: object) => Resultado;

export async function processarConversa(conversationId: string, deps: DepsOrquestrador): Promise<ResultadoProcessamento> {
  const { sim, ia } = deps;
  const estado = deps.estado ?? novoEstado();
  const relogio = deps.relogio ?? Date.now;
  const inicio = relogio();
  const agora = deps.agora ?? sim.agora();
  const acoes: ResultadoProcessamento["acoes"] = [];
  const chamar: Chamada = (nome, params) => {
    const r = (FERRAMENTAS[nome] as (s: Simulador, p: object) => Resultado)(sim, params);
    acoes.push({ ferramenta: nome, ok: r.ok, ...(r.ok ? {} : { erro: r.erro }) });
    return r;
  };
  const inicioLog = sim.log.length;

  // 1. Ler a conversa e consultar os sistemas.
  const lida = chamar("ler_conversa", { conversation_id: conversationId });
  if (!lida.ok) throw new Error(`conversa ${conversationId} não encontrada`);
  const ficha = montarContexto(conversationId, sim.base, agora)!;
  const conversa = ficha.conversa.valor;
  const orderId = conversa.order_id;
  if (orderId) chamar("consultar_pedido", { order_id: orderId, conversation_id: conversationId });
  chamar("consultar_cliente", { customer_id: conversa.customer_id, conversation_id: conversationId });
  chamar("ver_anexos", { conversation_id: conversationId });

  // 2. Classificar (Jev, texto mascarado).
  const mensagensCliente = ficha.mensagens.valor.filter((m) => m.autor === "cliente").map((m) => m.texto);
  const classificacao = await classificar(ia, { mensagensCliente, assunto: conversa.assunto, canal: conversa.canal });
  const motivo: Motivo = classificacao.motivo;
  if (orderId && MOTIVOS_FINANCEIROS.has(motivo)) chamar("verificar_pagamento", { order_id: orderId, conversation_id: conversationId });

  // 3. Evidências.
  const custoBrinde = Number(sim.base.produtos.find((p) => p.categoria === "Brindes de campanha")?.custo_unitario ?? 0);
  const pedido = ficha.pedido.valor;
  let sinais: ResultadoEvidencias | null = null;
  if (pedido && MOTIVOS_EVIDENCIA.has(motivo)) {
    sinais = calcularSinais({
      anexos: ficha.anexos.valor,
      pedido,
      itens: ficha.itens.valor,
      customerId: conversa.customer_id,
      nTrocas12m: ficha.resumo.reenviosCliente12m.valor,
      indiceHash: sim.base.indiceHash,
      nomesCatalogo: sim.base.produtos.map((p) => p.nome),
      dataReclamacao: conversa.data_abertura,
    });
  }

  // 4. Decidir (código).
  const fatos: FatosPedido = fatosParaPolitica(ficha) ?? { statusEntrega: "aguardando_separacao", valorPedido: 0 };
  const valorAcao = valorDaAcao(motivo, ficha, custoBrinde);
  const hoje = dia(agora);
  const ajustes: string[] = [];
  let decisao: DecisaoPolitica;
  if (!classificacao.valida) {
    decisao = {
      nivel: 2,
      nivelAcao: 2,
      aprovacaoResposta: true,
      acao: "falha_classificador",
      ferramenta: "encerrar_conversa",
      justificativa: `Classificador indisponível (${classificacao.falha}): uma pessoa assume o caso.`,
      precisaAprovacaoDe: "supervisor",
    };
  } else {
    decisao = decidirNivel({
      motivo,
      confiancaClassificador: classificacao.confianca,
      fatos,
      sinais: sinais?.sinais ?? [],
      valorAcao,
      canal: conversa.canal,
      mencaoSaude: classificacao.mencaoSaude,
      cenario: sim.cenario,
      hashesFotos: ficha.anexos.valor.map((a) => a.hash_perceptual),
      gastoAutonomoHojeRs: estado.gastoSemTetoPorDia.get(hoje) ?? 0,
      chaveAmostra: conversationId,
    });
  }
  let nivelFinal: Nivel = decisao.nivel;

  // 5. Ação.
  let executada = false;
  let extra: string | null = null;
  const base = { conversation_id: conversationId, order_id: orderId ?? undefined };
  const pedirAprovacao = (acao: string, valor: number, justificativa: string) =>
    chamar("solicitar_aprovacao", { acao, order_id: orderId ?? undefined, conversation_id: conversationId, valor, justificativa });

  if (decisao.acao === "falha_classificador") {
    chamar("acionar_pessoa", { area: "supervisão", assunto: "falha_classificador", contexto: `conversa ${conversationId}: classificação indisponível`, conversation_id: conversationId });
  } else if (decisao.nivel === 0) {
    let r: Resultado | null = null;
    const textoCliente = mensagensCliente.join(" ");
    switch (decisao.ferramenta) {
      case "informar_status":
        r = chamar("informar_status", { conversation_id: conversationId, order_id: orderId });
        break;
      case "abrir_chamado_transportadora":
        r = chamar("abrir_chamado_transportadora", { order_id: orderId, motivo: motivo === "rastreio" ? "rastreio_sem_atualizacao" : "atraso_entrega", conversation_id: conversationId });
        if (!r.ok && r.erro.startsWith("já existe chamado aberto")) {
          extra = `Já existe um chamado aberto com a ${pedido?.transportadora ?? "transportadora"} sobre a entrega deste pedido.`;
          r = { ok: true };
        }
        break;
      case "reenviar_produto": {
        // Atraso: reenvio ou reembolso à escolha do cliente; o texto do cliente indica a preferência.
        const reembolso = decisao.ferramentasAdicionais?.includes("reembolsar") && RE_PREFERE_REEMBOLSO.test(textoCliente);
        if (reembolso) {
          r = chamar("reembolsar", { ...base, valor: valorAcao, motivo });
          if (r.ok) decisao = { ...decisao, ferramenta: "reembolsar" };
        } else r = chamar("reenviar_produto", { ...base, valor: valorAcao, motivo });
        break;
      }
      case "reimprimir_personalizacao":
        r = chamar("reimprimir_personalizacao", { ...base, valor: valorAcao });
        break;
      case "reembolsar":
        r = chamar("reembolsar", { ...base, valor: valorAcao, motivo });
        break;
      case "cancelar_pedido":
        r = chamar("cancelar_pedido", { conversation_id: conversationId, order_id: orderId, motivo: "arrependimento" });
        if (r.ok) r = chamar("reembolsar", { ...base, valor: pedido?.valor ?? valorAcao, motivo: "cancelamento" });
        break;
      case "trocar_produto":
        r = chamar("trocar_produto", { ...base, valor: valorAcao, coleta_reversa: true });
        break;
      case "alterar_endereco":
        // O endereço fica na conversa (dado pessoal): a ferramenta registra a alteração sem gravá-lo.
        r = chamar("alterar_endereco", { conversation_id: conversationId, order_id: orderId, novo_endereco: "informado pelo cliente na conversa" });
        break;
      case "negar_por_politica":
        r = chamar("negar_por_politica", { conversation_id: conversationId, regra: decisao.justificativa });
        break;
      case "solicitar_foto":
        r = chamar("solicitar_foto", { conversation_id: conversationId });
        break;
      case "validar_cupom": {
        const codigo = pedido?.cupom ?? sim.base.usoCupons.filter((u) => u.customer_id === conversa.customer_id).at(-1)?.codigo;
        if (codigo) {
          r = chamar("validar_cupom", { codigo, order_id: orderId ?? undefined, conversation_id: conversationId });
          if (r.ok) {
            const m = (r.dados as { motivo: string | null }).motivo;
            extra = m ? `Informar que o cupom ${codigo} não foi aplicado pelo motivo da plataforma: ${m}.` : `Informar que o cupom ${codigo} consta como válido na plataforma.`;
          }
        } else {
          extra = "Pedir ao cliente o código do cupom para verificar na plataforma.";
          r = { ok: true };
        }
        break;
      }
      case "verificar_pagamento": {
        const ef = ficha.resumo.cobrancasEfetivadas.valor.length;
        extra = ef > 0 ? "Informar que o pagamento consta como confirmado no sistema de pagamentos." : "Informar que o pagamento ainda não consta como confirmado; pix compensa em até 30 minutos e boleto em até 2 dias úteis.";
        r = { ok: true };
        break;
      }
      case "responder_duvida": {
        const prod = pedido ? sim.base.produtos.find((p) => p.sku === pedido.sku) : undefined;
        const campos = prod ? CAMPOS_FICHA.map((k) => (prod[k] !== null && prod[k] !== undefined && prod[k] !== "" ? `${k.replaceAll("_", " ")}: ${String(prod[k])}` : null)).filter(Boolean) : [];
        extra = `Responder a dúvida usando só a ficha do produto ${prod?.nome ?? ""}: ${campos.join("; ")}`;
        r = { ok: true };
        break;
      }
      case "agradecer":
        r = chamar("agradecer", { conversation_id: conversationId });
        break;
      case "encerrar_conversa":
        // Sem demanda: nada a executar além de encerrar (passo 7), sem resposta ao cliente.
        r = { ok: true };
        break;
      default:
        r = { ok: true };
    }
    if (r && r.ok) {
      executada = true;
      if (decisao.acaoSemTeto) estado.gastoSemTetoPorDia.set(hoje, (estado.gastoSemTetoPorDia.get(hoje) ?? 0) + valorAcao);
    } else {
      nivelFinal = 1;
      ajustes.push(`ferramenta ${decisao.ferramenta} recusou a ação: vai para aprovação`);
      pedirAprovacao(decisao.ferramenta, valorAcao, `${decisao.justificativa} (recusa: ${r && !r.ok ? r.erro : "?"})`);
    }
  } else if (decisao.nivel === 1) {
    pedirAprovacao(decisao.ferramenta, valorAcao, decisao.justificativa);
  } else {
    // Nível 2
    if (decisao.ferramenta === "sinalizar_suspeita") {
      chamar("sinalizar_suspeita", {
        conversation_id: conversationId,
        order_id: orderId ?? undefined,
        sinais: sinais?.sinais ?? [],
        evidencias: sinais?.detalhes.map((x) => x.evidencia) ?? [decisao.justificativa],
      });
    } else if (motivo === "reacao_adversa") {
      chamar("orientar_suspensao_uso", { conversation_id: conversationId });
      chamar("acionar_pessoa", { area: "qualidade", assunto: "cosmetovigilancia_24h", contexto: `conversa ${conversationId}, pedido ${orderId ?? "-"}: registrar cosmetovigilância em até 24 h`, urgencia: "alta", conversation_id: conversationId });
    } else {
      chamar("acionar_pessoa", { area: "supervisão", assunto: decisao.acao, contexto: `conversa ${conversationId}, pedido ${orderId ?? "-"}`, conversation_id: conversationId });
    }
  }

  // 6. Redigir.
  let redacao: ResultadoRedacao | null = null;
  let texto: string;
  const semDemanda = motivo === "sem_demanda" && nivelFinal === 0;
  if (decisao.acao === "falha_classificador") {
    texto = TEXTO_RESERVA;
  } else if (semDemanda) {
    texto = ""; // o cliente não escreveu nada: não há o que responder
  } else if (decisao.mensagemCliente) {
    texto = decisao.mensagemCliente; // caso sinalizado: só "em análise", sem modelo
  } else {
    redacao = await redigir(ia, {
      decisao: { ...decisao, nivel: nivelFinal },
      acaoExecutada: executada,
      descricaoAcao: descreverAcao(decisao, executada, ficha, decisao.ferramenta === "cancelar_pedido" ? (pedido?.valor ?? valorAcao) : valorAcao, extra),
      fatos: fatosTexto(ficha),
      mensagensCliente,
      marca: conversa.marca,
      canal: conversa.canal,
    });
    texto = redacao.texto;
    if (redacao.reserva && nivelFinal === 0) {
      nivelFinal = 1;
      ajustes.push("redação reprovada na checagem: texto de reserva e resposta para aprovação");
    }
  }

  // 7. Responder (ou rascunho) e encerrar.
  const podeEnviar = !decisao.aprovacaoResposta && (nivelFinal === 0 || (decisao.mensagemCliente === MENSAGEM_EM_ANALISE && decisao.nivel === 2));
  let enviada = false;
  if (semDemanda) {
    chamar("encerrar_conversa", { conversation_id: conversationId, motivo: decisao.acao });
  } else if (podeEnviar) {
    enviada = chamar("responder_cliente", { conversation_id: conversationId, texto }).ok;
  } else {
    pedirAprovacao("responder_cliente", 0, decisao.aprovacaoResposta ? "Reclame Aqui: resposta pública precisa de aprovação." : "Rascunho de resposta para aprovação junto com o caso.");
  }
  const aguardaCliente = decisao.ferramenta === "solicitar_foto" || (decisao.ferramenta === "validar_cupom" && extra?.startsWith("Pedir"));
  if (enviada && nivelFinal === 0 && !aguardaCliente) chamar("encerrar_conversa", { conversation_id: conversationId, motivo: decisao.acao });

  const log = sim.log.slice(inicioLog).filter((l) => l.conversation_id === conversationId);
  const jevUso = classificacao.uso;
  const chatUso = redacao?.uso ?? { entrada: 0, saida: 0, custoUsd: null };
  return {
    conversation_id: conversationId,
    classificacao,
    ficha,
    sinais,
    decisao: { ...decisao, motivo, nivelFinal, ajustes },
    acoes,
    log,
    resposta: {
      texto,
      enviada,
      paraAprovacao: !enviada && !semDemanda,
      reserva: redacao?.reserva ?? texto === TEXTO_RESERVA,
      tentativas: redacao?.tentativas ?? 0,
      falhasChecagem: redacao?.falhas ?? [],
    },
    telemetria: {
      ms: relogio() - inicio,
      jev: { ms: classificacao.ms, tokensEntrada: jevUso.entrada, tokensSaida: jevUso.saida, custoUsd: jevUso.custoUsd },
      chat: { ms: redacao?.ms ?? 0, tokensEntrada: chatUso.entrada, tokensSaida: chatUso.saida, custoUsd: chatUso.custoUsd },
      custoUsdEstimado: (jevUso.custoUsd ?? 0) + (chatUso.custoUsd ?? 0),
      sistemasAcessados: new Set(log.map((l) => l.sistema)).size,
    },
  };
}

