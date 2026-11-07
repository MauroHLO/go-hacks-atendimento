# Decisões

## 1. Análise de atendimento (`analysis/analise_atendimento.py`)

**Reaproveitamento.** Estrutura adaptada de `../_referencia/analysis/analise_atendimento.py`: configuração no topo, carga, uma função por análise, impressão em seções e gravação em `data/processed/` com `metricas.json`. Reaproveitados a função `minutos_uteis` (SLA do WhatsApp em horário comercial) e o padrão de mascaramento de PII. Não reaproveitado: o classificador por regras e a regra de autonomia, que ficam para `lib/agent` e `lib/policy`; os dados agora vêm de outras tabelas e com outras regras.

**Decisões de cálculo**

- **Amostra.** O histórico é amostra de 1 em 4 clientes. Volume, custo e horas saem com o valor da amostra e o escalado (×4). Taxas (%) não são escaladas. A fila aberta está em volume cheio e não é escalada.
- **Período.** Histórico de 04/08 a 01/11/2026 = 90 dias = 3 meses de 30 dias. Valores "por mês" = período ÷ 3. Escalado dá 3.979 conversas/mês, coerente com as "cerca de 4.000" de `parametros.md`.
- **Custo.** Custo por conversa do canal (WhatsApp R$ 4,80; e-mail R$ 7,20; Reclame Aqui R$ 42,00) aplicado a todas as conversas, inclusive as só de bot (sem tag), porque a tabela é por conversa.
- **Tempo.** `minutos_trabalhados` e `sistemas_acessados` vêm de `tempo_por_conversa.csv`, que não tem as 330 conversas só de bot (não houve trabalho humano). Médias calculadas sobre as conversas presentes; horas totais = soma ÷ 60.
- **Fora do horário.** Abertura com hora < 8 ou ≥ 20.
- **SLA de primeira resposta.** Espera = `data_primeira_resposta` − `data_abertura` (primeira resposta humana). WhatsApp: conta só minutos entre 8h e 20h, todos os dias (os humanos atendem todos os dias). E-mail e Reclame Aqui: tempo corrido. Conversas sem resposta humana (330 WhatsApp só de bot) ficam fora do denominador e são informadas à parte.
- **Recontato.** Pedido com mais de uma conversa no histórico. Taxa de recontato de um recorte = conversas desses pedidos ÷ conversas do recorte. Conversas sem pedido (337) ficam fora. Recorte transportadora×UF só entra com 30 conversas ou mais; as demais tabelas (máquina, lote, CD) vão completas com a contagem, para o leitor julgar o tamanho.
- **Brinde.** Pedido com "+ Brinde" em `descricao_produto`.
- **Cobrança duplicada.** Pedido com mais de uma transação em status capturada, paga ou estornada em `pagamentos_gateway`. "Com estorno" = alguma transação do pedido estornada ou com `valor_estornado` > 0, ou estorno `concluido` em `estornos.csv`. Excedente sem estorno = soma das cobranças efetivadas menos a maior delas.
- **Evidências (por anexo).** `hash_mesmo_pedido`: outro anexo do mesmo pedido com o mesmo hash; `hash_outro_pedido`/`hash_outro_cliente`: o hash aparece em mais de um pedido/cliente. `exif_antes_entrega`: `exif_data_captura` anterior a `data_entrega` (data, sem hora; comparação com timestamp à meia-noite da entrega). `exif_software_edicao`: `exif_software` preenchido. `fora_prazo_7d`: envio mais de 7 dias após a entrega. `reenvios_anteriores_oms`: solicitações em `trocas_reenvios` do mesmo cliente antes do envio da foto; `n_trocas_12m` vem do CRM como está. `n_sinais` é só uma contagem descritiva, não é o score do verificador (esse fica em `lib/evidencias`). A tabela `anexos_sinais.csv` não traz `descricao_visual` nem EXIF bruto (texto e metadados do cliente). O sinal "descrição visual incompatível" depende de leitura do texto e fica para o verificador.
- **Fila.** Idade = 02/11/2026 08:00 − abertura. Espera de SLA: até a primeira resposta, se houve; senão até agora, com a mesma regra de horário do WhatsApp. Às 08:00 nenhum WhatsApp aberto estourou porque o relógio comercial começa às 8h, mas 18 deles estouram às 08:30 se ninguém responder (`sla_restante_min`). O assunto é texto do cliente: é mascarado (CPF, telefone, e-mail, cartão) antes de agregar e não vai para a tabela por conversa.

## 2. App base e motor de política (`app/`)

**Reaproveitado de `../_referencia/app`** (copiado sem `node_modules`, `.next` e `.env*`):

- Configuração Next.js 16, Tailwind, ESLint, Vitest e `tsconfig` como estavam; `layout.tsx` e `globals.css` (só o título mudou).
- `lib/pii` e `lib/limites`, com os testes, sem alteração.
- `lib/agent/sinais.ts` (detecção de menção de saúde e ameaça), com os testes, sem alteração. Serve de entrada `mencaoSaude` do motor.
- `lib/rota/handler.ts` e testes, com o comportamento HTTP intacto (origem, 10 KB, zod, limites por IP e global, logs sem texto, exceção vira nível 2). **Mudança necessária:** na referência a rota importava o pipeline antigo (`lib/agent`), a contingência da demo e os tipos da policy antiga. Como a policy foi reescrita e o pipeline antigo saiu, a rota passou a receber o pipeline injetado (`processar`) e a contingência opcional, com o contrato mínimo em `lib/rota/contrato.ts`. O status de entrega no corpo aceito passou a ser o dos dados deste desafio (`aguardando_separacao`, `em_transito`, `entregue`, `extraviado`, `devolvido`, `cancelado`). Nos testes, o cliente Groq falso virou um pipeline falso; as asserções de HTTP, limites e privacidade continuam as mesmas, e foi acrescentado um teste da contingência injetada.

**Removido** (específico do projeto anterior): `lib/faq`, `lib/acoes`, `lib/demo` (exemplos, gravações e contingência), `lib/impacto` (números de outra base; fica um stub que vai ler `data/processed/metricas.json`), o pipeline de `lib/agent` (cliente Groq, esquema, prompts, checagem), os componentes da página, a rota `api/agent`, os scripts `smoke` e `avaliar-classificador` e a dependência `groq-sdk`. O LLM agora é o AI Proxy da GoGroup (Jev + chat completions) e o pipeline será reescrito para ele; a rota `api/agent` volta quando houver pipeline para injetar. A página é provisória.

**Reescrito: `lib/policy`.** A policy antiga tinha outra tabela (saúde/ameaça/recontato como escalonadores, limite único de R$ 200, +1 nível por confiança). A nova segue a tabela de autonomia do time:

- `regras.ts`: todas as constantes, cada uma com a origem em comentário (`politicas.csv`, `ferramentas.csv`, `parametros.md`, CLAUDE.md). Também os textos das regras usados na justificativa e o cálculo de dias úteis com os feriados de `politicas.csv`.
- `decidirNivel({ motivo, confiancaClassificador, fatos, sinais, valorAcao, canal, mencaoSaude? })` devolve `{ nivel, acao, ferramenta, ferramentasAdicionais?, justificativa, precisaAprovacaoDe?, mensagemCliente? }`. A justificativa sempre cita a regra de origem entre colchetes.
- Ordem: regra do motivo → limite do atendente pela ferramenta (reenvio/reimpressão/troca R$ 200, reembolso R$ 100; acima, nível 1) → Reclame Aqui (mínimo 1) → confiança < 0,7 (mínimo 1). Os ajustes só sobem; nível 2 nunca desce. 0,7 exato não sobe.
- `precisaAprovacaoDe: "supervisor"` em todo nível 1 e 2 (a tabela diz "pessoa aprova"; nas ferramentas quem aprova e decide suspeita é o supervisor).
- `podeAprovar` e `podeDecidirSuspeita`: só supervisor, nunca a própria ação nem a suspeita que ele mesmo sinalizou.

**Interpretações da tabela (revisar com o time):**

- *Evidência (avaria, item faltante, brinde, personalização).* Ordem: pedido entregue com data de recebimento (senão nível 1) → fora de 7 dias: `negar_por_politica` nível 0 (é elegibilidade, não suspeita) → sem foto: `solicitar_foto` nível 0 → **sinal forte: sempre nível 2** com `sinalizar_suspeita` e só a mensagem "em análise", antes de qualquer fórmula → sem sinal forte, **a fórmula decide entre 0 e 1, inclusive com sinais fracos**: nível 0 se p × 0,45 × valor do pedido < R$ 6 e `valorAcao` ≤ limite do atendente; senão nível 1. Bordas do valor do pedido: R$ 266,66 sem sinal, R$ 88,88 com um fraco, R$ 44,44 com dois. *Revisão (commit "fix: fórmula de custo…")*: na primeira versão a tabela exigia "nenhum sinal" e "sem reenvio em 12 meses" para o nível 0; agora 1 reenvio em 12 meses sozinho não muda o nível, e 2 ou mais contam como sinal fraco dentro da fórmula.
- *Probabilidades* 0,05 / 0,15 / 0,30 / 0,90 são hipótese do time, marcadas em `regras.ts`. "Cliente com 2 ou mais reenvios em 12 meses" é derivado de `reenviosCliente12m` além de poder vir como sinal.
- *Rastreio.* Atraso conhecido acima de 0 aplica a regra de atraso. Atraso desconhecido com pedido em trânsito ou aguardando separação informa o status (só leitura). Pedido entregue, devolvido ou cancelado: nível 1.
- *Atraso.* 0 ou menos dias úteis de atraso: informa status (regra de rastreio "dentro do prazo"). Extravio ou mais de 7: nível 1 com `reenviar_produto` e alternativa `reembolsar`.
- *Endereço.* "Em separação" = status `aguardando_separacao` com `data_separacao` preenchida.
- *Cancelamento e troca de fragrância*: sempre nível 1, mas a ferramenta preparada segue a política (cancelar antes da separação, reembolso em até 7 dias do recebimento, negativa fora do prazo; troca só com 0 trocas e até 30 dias).
- *Cobrança duplicada* não confirmada no gateway, ou já estornada, ou sem essa informação: nível 1 com `verificar_pagamento`.
- *Fato ausente* necessário para decidir: nível 1 (o motor não supõe).
- *Pagamento pendente*: nível 0 com `verificar_pagamento` e `informar_status`. *Elogio*: nível 0 com `agradecer`. (Decisão do time; antes estavam no nível 1.)
- *Motivos fora da tabela* (`sem_interacao`, `outro`): nível 1 até o time definir. Pendente de decisão: só nas conversas só de bot (`sem_interacao`) seriam 330 na amostra.
