# Ponta Firme

**O agente de atendimento que resolve sozinho onde é seguro e chama uma pessoa só onde ela faz diferença.**

GoHacks Talent 2026 (Gogroup), Desafio 1: Atendimento ao Cliente (Gocase e GoBeauté). O nome vem da cultura Gogroup: se compromete, cumpre e cumpre bem.

- **App:** https://app-sigma-drab-58.vercel.app
- **Código:** https://github.com/gohacks20-code/go-hacks-atendimento

O modelo classifica e redige; o código decide o que se resolve sozinho e o que precisa de uma pessoa.

## Problema

Números da análise do histórico (04/08 a 01/11/2026). O histórico é uma amostra de 1 em 4 clientes, e os valores abaixo estão escalados × 4 (`analysis/analise_atendimento.py` → `data/processed/metricas.json`):

| | por mês |
| --- | --- |
| conversas | 3.979 |
| custo de atendimento | R$ 38.419 |
| horas de atendimento | 717,5 h (12,2 min por conversa) |
| conversas com pedido que são recontato | 37,1% |

Os pontos do enunciado aparecem nos dados:

- **Trabalho espalhado:** 1,83 sistema consultado por conversa, um portal de cada vez.
- **Reclamação verdadeira?** 36 imagens repetidas (mesmo hash) em 77 anexos, 11 com EXIF anterior à entrega e 82 reclamações fora do prazo de 7 dias.
- **Contatos evitáveis:** a Expressa Já tem 62% de recontato (as demais transportadoras, 20,2%), e o brinde da campanha não chegou.

## Solução

Um agente com cinco módulos em `app/src/lib/`:

1. **Ficha única** (`contexto`): junta ERP, portal da transportadora, gateway, OMS, CRM e anexos numa ficha, com a origem de cada campo. A ficha é montada na data da conversa.
2. **Classificador** (`agent`): o Jev classifica motivo, urgência e seis sinais de sim/não sobre o texto mascarado. Não decide nada.
3. **Verificador de evidências** (`evidencias`): aponta foto repetida, EXIF, produto da foto diferente do pedido, prazo e histórico de reenvios. Cada sinal vem com a evidência.
4. **Motor de política** (`policy`): código determinístico, com 460 testes no app. Define o nível de cada caso:
   - **nível 0:** o agente resolve;
   - **nível 1:** uma pessoa aprova;
   - **nível 2:** uma pessoa é obrigatória.

   Cada decisão cita a regra de `politicas.csv`, `ferramentas.csv` ou `parametros.md`. Princípio adotado: **direito comprovado por sistema** (cobrança em dobro, cancelamento antes da separação, atraso acima de 7 dias úteis, troca de fragrância) resolve no nível 0, sem teto até o valor do pedido.
5. **Ferramentas e agente analista** (`ferramentas`, `agent/analista`):
   - 26 ferramentas simuladas, com papel, limite e log no formato `acoes_executadas_sistemas`.
   - O analista abre incidentes (transportadora × UF, brinde, cobrança em dobro) e avisa os clientes afetados antes que eles escrevam, só com consentimento e no máximo 300 por dia.

A interface tem uma página com sete abas: Visão geral, Fila de agora, Casos do histórico, Agente analista, Autonomia, Como conferimos a IA e Teste ao vivo.

## Uso de IA

O AI Proxy da Gogroup (formato OpenAI) é chamado por `fetch` (`lib/agent/cliente.ts`). Há duas chamadas:

- **Jev** (`POST /v1/systemone`): perguntas choice, score e noul, com probabilidades.
- **Redação** (`POST /v1/chat/completions`).

Garantias:

- **Dados pessoais:** CPF, telefone, e-mail e cartão são mascarados antes de qualquer chamada. O texto do cliente vai entre delimitadores e é tratado como dado, nunca como instrução.
- **Decisão:** o modelo não decide ação nem nível.
- **Checagem da redação:** toda redação passa por uma checagem em código antes de sair. Ela barra número sem fonte, acusação, lei sem fonte, promessa que a ação não cumpre, ação dada como feita sem ter sido e dado pessoal. Uma recusa gera nova redação; a segunda recusa troca o texto por um de reserva e manda para aprovação. Caso sinalizado recebe só "em análise", sem passar pelo modelo.
- **Robustez:** Jev indisponível leva o caso ao nível 2. Para o HTTP 429 do proxy, há nova tentativa, no máximo 2 conversas ao mesmo tempo na rota e contingência com o resultado gravado, avisada na tela.

## Resultados

### Simulação

As 2.984 conversas do histórico passaram pelo motor real, política vigente × nova política, com p = 0,05 e mês = amostra × 4 ÷ 3 (`npm run simular` → `data/processed/simulacao_autonomia.json`):

| | vigente | nova política |
| --- | --- | --- |
| **conversas sem nenhuma pessoa** (sem as 330 em que o cliente não escreveu nada) | 57,5% | 67,7% |
| conversas sem nenhuma pessoa, com todas no denominador | 62,2% | 71,2% |
| **ações executadas sozinho** | 62,2% | 79,6% |
| horas liberadas por mês | 366,4 | 433,1 |

As duas métricas principais diferem por causa do Reclame Aqui. A ação sai sozinha, mas a resposta pública passa por uma pessoa. O saldo (custo evitado − perda esperada − atrito − auditoria) fica positivo nos três valores de p testados (0,02, 0,05 e 0,10).

### Fila de 02/11, 08:00

As 65 conversas passaram pelo AI Proxy real (`npm run processar-fila`):

- 90,8% das ações no nível 0;
- 33 respostas enviadas sem pessoa;
- nenhuma classificação inválida;
- 3,2 s por conversa;
- US$ 0,0026 de Jev no lote.

### Avaliação do Jev

- Concordância de 59% com a tag do atendente.
- Na revisão manual dos 20 desencontros de maior confiança, o Jev acertou os 20. A acurácia mínima na amostra de 120 é de 76%.
- Achado de segurança: uma reação adversa estava registrada como "Avaria".

### Recomendação de política nº 1

Em 65% dos reenvios por atraso, o pedido original chegou depois. Isso custa cerca de R$ 7,6 mil por mês, e o custo é da política, não da autonomia.

O passo a passo de cada decisão, as limitações e o que a IA errou estão em [`docs/decisoes.md`](docs/decisoes.md) e [`docs/acoes.md`](docs/acoes.md).

## Como rodar

Pré-requisitos: Python 3 com pandas e Node 20 ou mais recente. Os dados originais ficam em `data/raw/atendimento/` (fora do Git).

```bash
# análise e exportação para o app
python -m venv .venv && .venv/Scripts/pip install -r analysis/requirements.txt   # no Linux/macOS: .venv/bin/pip
.venv/Scripts/python analysis/analise_atendimento.py
.venv/Scripts/python analysis/exportar_app.py

# app
cd app
npm install
npm test               # testes (o proxy é simulado nos testes)
npm run simular        # simulação de autonomia → data/processed
npm run processar-fila # lote da fila com o AI Proxy (lê ../.env.local)
npm run avaliar-jev    # avaliação do Jev
npm run casos-demo     # três casos do histórico
npm run anexos-conferidos
npm run copiar-dados   # data/processed → app/src/dados/processados
npm run dev            # http://localhost:3000
```

Variáveis em `.env.local` na raiz, e nas variáveis da Vercel para o deploy: `AI_PROXY_BASE_URL`, `AI_PROXY_API_KEY` e `AI_PROXY_MODEL`. Sem elas, a interface funciona com os resultados gravados, e o Teste ao vivo usa a contingência.

## Estrutura

```
analysis/              scripts Python que geram os números (data/processed)
app/                   Next.js + TypeScript (raiz na Vercel)
  scripts/             simulação, lote da fila, avaliação do Jev, casos, cópia de dados
  src/lib/             contexto, agent, evidencias, policy, ferramentas, pii, limites, rota, painel
  src/dados/           JSON da fila (mensagens mascaradas) e processados/ (resultados)
  src/app/             interface (page.tsx, _componentes/) e api/agent (rota pública)
data/processed/        agregados e resultados versionados (sem texto livre de cliente)
docs/decisoes.md       decisões e justificativas
docs/acoes.md          relatório de ação, um item por commit
```

Dados sintéticos fornecidos pela Gogroup para o GoHacks Talent 2026. Este não é um produto oficial da Gogroup, e as ações das ferramentas são simuladas.
