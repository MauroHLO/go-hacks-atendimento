// POST /api/agent: conversa da fila (e mensagem fictícia opcional) → orquestrador → ficha completa.
// Chave do AI Proxy só no servidor (variáveis de ambiente); mesma origem, até 10 KB de corpo e 2.000
// caracteres de mensagem, limites de lib/limites, no máximo 2 conversas ao mesmo tempo, nova tentativa
// no 429 e contingência com o resultado gravado (docs/decisoes.md, seção 7).

import { configDoAmbiente, criarClienteProxy } from "@/lib/agent/cliente";
import { contingenciaGravada } from "@/lib/agent/contingencia";
import { ConversaDesconhecida, criarAgente } from "@/lib/agent/servico";
import { resultadoFalha, type Processar } from "@/lib/rota/contrato";
import { criarHandler, criarLimitesPadrao } from "@/lib/rota/handler";

// Com Cache Components (Next 16), "runtime" e "dynamic" não podem ser exportados: o runtime padrão já é
// Node.js, POST nunca é pré-renderizado e o handler devolve Cache-Control: no-store.
export const maxDuration = 60; // até 2 conversas por vez, cada uma com Jev (10 s) e redação (até 2 × 30 s)

let handler: ((req: Request) => Promise<Response>) | null = null;

function montar(): (req: Request) => Promise<Response> {
  let processar: Processar;
  let modelo: string | undefined;
  try {
    const ia = criarClienteProxy(configDoAmbiente());
    modelo = ia.modelo;
    const agente = criarAgente({ ia });
    processar = async (e) => {
      try {
        return await agente(e);
      } catch (err) {
        if (err instanceof ConversaDesconhecida) return resultadoFalha("requisicao_recusada");
        throw err;
      }
    };
  } catch {
    processar = async () => resultadoFalha("config"); // sem variáveis: só a contingência gravada
  }
  return criarHandler({ processar, limites: criarLimitesPadrao(), modelo, contingencia: contingenciaGravada });
}

export async function POST(req: Request): Promise<Response> {
  handler ??= montar();
  return handler(req);
}
