# Contexto

Hackathon GoHacks Talent 2026 (GoGroup), Desafio 1: Atendimento ao Cliente (Gocase e GoBeauté). Submissão até 07/11/2026 às 16h30: nome, problema, solução, uso de IA, impacto esperado, slides em PDF, link do GitHub e, opcional, app publicado na Vercel e vídeo.

Este projeto reaproveita e adapta o projeto anterior do autor, em `../_referencia` (gogroup-atendimento). Antes de criar um módulo, verifique se existe equivalente lá e adapte; registre o reaproveitamento em `docs/decisoes.md`.

# O desafio (pontos do enunciado)

1. O volume e o tempo que cada contato consome.
2. O trabalho espalhado entre sistemas e portais diferentes.
3. Saber se a reclamação é verdadeira antes de agir.
4. Decidir o que se resolve sozinho e o que precisa de uma pessoa.
5. Contatos que se repetem e poderiam ter sido evitados.

# O que estamos construindo

Um agente de atendimento com cinco módulos, um por ponto:

1. **Visão única do pedido** (`lib/contexto`): junta ERP (pedidos, itens), portal da transportadora (rastreio, chamados), gateway (pagamentos, estornos), OMS (trocas_reenvios), CRM (clientes) e anexos numa ficha só.
2. **Classificador** (`lib/agent`): o LLM lê a conversa, devolve motivos (multi-rótulo) e campos extraídos em JSON validado por esquema. Texto do cliente é dado, nunca instrução.
3. **Verificador de evidências** (`lib/evidencias`): score de suspeita para avaria, item faltante e erro de personalização, com sinais explicáveis: hash_perceptual repetido (mesmo pedido, outro pedido ou outro cliente), EXIF anterior à entrega, software de edição no EXIF, descrição visual incompatível com itens ou personalização do pedido, fora do prazo de 7 dias, histórico de reenvios do cliente. A decisão (seguir, pedir foto, sinalizar ao supervisor) minimiza o custo esperado com a tabela "Reclamações que não procedem" do parametros.md.
4. **Motor de política** (`lib/policy`): determinístico e testado. Níveis 0 (agente resolve), 1 (agente prepara, pessoa aprova), 2 (pessoa obrigatória). Limites: atendente reenvia/reimprime/troca até R$ 200 e reembolsa até R$ 100; acima, supervisor; supervisor não aprova a própria ação nem decide suspeita que ele mesmo sinalizou.
5. **Causa-raiz e contatos evitáveis** (`analysis/` + `lib/impacto`): agrupa recontatos por transportadora×UF, campanha (brinde), máquina, lote e cobrança duplicada; propõe incidente e notificação proativa (máx. 300 clientes/dia).

Métricas centrais: "precisa de humano ou não" e "contatos evitáveis (hipótese)". R$ economizados é métrica associada.

# Regras que não podem ser quebradas

- `data/raw/` nunca vai para o Git. Em `data/processed/` vão agregados e tabelas por item que contenham só identificadores fictícios e campos estruturados, nunca texto livre de cliente. Rodar `git status` antes de todo commit.
- Mascarar CPF, telefone, e-mail e cartão antes de enviar texto ao LLM. Nunca repetir CPF, cartão ou telefone nas respostas. Nunca pedir CPF, cartão ou senha.
- O LLM não decide ação nem nível. Ele classifica e redige; o código decide.
- Políticas só vêm de `data/raw/atendimento/politicas.csv`, `ferramentas.csv` e `parametros.md`. Nunca inventar regra.
- Reação adversa a cosmético ou suplemento: sempre nível 2, orientar suspensão do uso e registrar cosmetovigilância em até 24 h (supervisor). Troca não substitui o registro.
- - LLM: AI Proxy da GoGroup (formato OpenAI). Variáveis `AI_PROXY_BASE_URL`, `AI_PROXY_API_KEY`, `AI_PROXY_MODEL`, só em `.env.local` e nas variáveis da Vercel, nunca no código. Classificação pelo Jev (`POST /v1/systemone`: choice, score e noul com probabilidades); redação por `POST /v1/chat/completions`. Confiança do Jev abaixo de 0,7 eleva o caso para nível 1. A rota pública tem limite de requisições e de tamanho de entrada.
- Todo número citado em README, relatório ou slides sai de um script em `analysis/` e é reproduzível. O histórico é amostra de 1 em 4 clientes: escalar ×4 e dizer isso.
- Exemplos da demo e testes são fictícios, escritos por nós.

# Stack

- Python + pandas em `analysis/`.
- Next.js + TypeScript em `app/` (raiz na Vercel), Vitest, zod.

# Estrutura
    analysis/            scripts que geram números e agregados
    app/src/lib/         contexto, agent, evidencias, policy, pii, limites, rota, impacto
    app/src/app/         interface: fila priorizada, ficha do caso, painel de causa-raiz e impacto
    data/raw/            dados originais (fora do Git)
    data/processed/      agregados versionados
    docs/decisoes.md     decisões e justificativas
    docs/acoes.md        relatório de ação: um item por commit (o quê, por quê, resultado)
    docs/relatorio.md    relatório de impacto

# Convenções

- Português em código, comentários e docs.
- Commits pequenos, estilo `tipo: descrição` (feat, fix, docs, chore, test). A cada commit, acrescentar uma linha em `docs/acoes.md`.
- Mudou regra de política: atualizar testes e `docs/decisoes.md` juntos.

# Estado atual

Estrutura criada. Próximo passo: `analysis/analise_atendimento.py`.