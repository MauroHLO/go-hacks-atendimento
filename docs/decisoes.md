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

## 3. Contexto único, evidências e ferramentas simuladas

**Exportação para o app (`analysis/exportar_app.py` → `app/src/dados/*.json`).** Só o necessário para as 65 conversas da fila de 02/11 08:00 (58 pedidos, 61 clientes): conversas (assunto mascarado), mensagens, pedido, itens, eventos de rastreio, pagamentos, estornos, chamados, trocas e reenvios do cliente (em todos os pedidos dele), cliente, anexos dos pedidos e clientes da fila, índice `hash_perceptual → [anexo, pedido, cliente]` sobre **todos** os 382 anexos, catálogo de produtos (ficha para `responder_duvida` e comparação com a foto), cupons e uso de cupons dos clientes da fila, `politicas.csv` e `ferramentas.csv`.

- **Exceção à regra de texto livre.** As mensagens da fila entram no repositório porque o agente precisa lê-las e porque os dados são sintéticos e fornecidos pela organização. Entram com CPF, telefone, e-mail e cartão mascarados pelas mesmas expressões de `lib/pii` (portadas para o script). O script também procura sequências parecidas com documento ou telefone sem formatação e lista o que sobrar: na exportação atual, 4 mensagens foram mascaradas e nenhuma sequência suspeita sobrou. Primeiros nomes nas saudações ("Olá, Bruna!") não são cobertos pela regra de mascaramento e ficam.
- **Removido na exportação:** nome, CPF, telefone, e-mail, nascimento, cidade, UF e CEP do cliente; CEP e cidade de entrega do pedido; `end_to_end_pix` do pagamento; `texto_personalizacao` das trocas. O `texto_personalizacao` dos itens fica, porque é o que se compara com a foto e se reimprime.
- A fila não tem anexos próprios (as fotos chegam durante o evento por `ver_anexos`). Por isso o índice de hash cobre todos os anexos do histórico: é com ele que uma foto nova é comparada.

**`lib/dados`.** Tipos e carga dos JSON. Datas sem fuso, tratadas como UTC ingênuo; "agora" = 2026-11-02 08:00 (`parametros.md`). `baseVazia()` monta bases fictícias para os testes.

**`lib/contexto`: `montarContexto(conversation_id)`.** Ficha com a origem de cada campo (ERP de pedidos, Portal da transportadora, Gateway de pagamentos, OMS de trocas e reenvios, CRM, Catálogo, Central de atendimento, ou "Calculado (de onde)").

- *Dias úteis de atraso* = dias úteis de `data_prometida` (ERP) até a entrega, ou até hoje se não entregue, com os feriados de `politicas.csv` (os de `parametros.md`, mais 25/12 e 01/01). Entrega antes do prometido = 0.
- *Rastreio parado* = dias úteis desde o último evento do portal até hoje, só para pedido ainda não entregue.
- *Dias desde o recebimento* = dias corridos completos entre a entrega e agora.
- *Cobranças efetivadas* = capturada, paga ou estornada (mesma regra da análise); *já estornada* = alguma estornada ou com `valor_estornado` > 0, ou estorno `concluido`.
- *Reenvios anteriores* = trocas, reenvios e novas produções do cliente com solicitação antes de agora; *trocas no pedido* = tipo `troca` no pedido; *chamados abertos* = status diferente de `encerrado`.
- `fatosParaPolitica(ficha)` converte a ficha nos `FatosPedido` do motor.

**`lib/evidencias`: `calcularSinais`.** Cada sinal vem com uma evidência curta e verificável (anexo, data, hash, pedido), sem acusação.

- *Fortes:* mesma imagem (hash) em outro pedido ou de outro cliente (a mesma foto reenviada no mesmo pedido não conta); EXIF de captura anterior à data de entrega; produto da foto diferente do pedido.
- *Produto diferente*, em ordem: (1) etiqueta com o número de outro pedido; (2) nome de produto do catálogo citado na descrição que não está no pedido; (3) categoria genérica (capinha, copo, garrafa, necessaire, bolsa, Connect Card, mala) que não existe no pedido; (4) mesma categoria, mas a foto mostra estampa e o pedido é personalizado por nome ou iniciais (personalização por foto pode parecer estampa, então não conta). Caixa ou embalagem sem produto identificável não gera sinal.
- *Fracos:* software no EXIF; cliente com 2 ou mais trocas/reenvios em 12 meses (CRM).
- *Elegibilidade:* sem foto; reclamação mais de 7 dias corridos após a entrega.
- *Conferência com os dados reais* (fora do repositório, sobre os 382 anexos do histórico): 17 anexos com hash em outro pedido/cliente, 11 com EXIF antes da entrega, 10 com software de edição e 82 fora do prazo, os mesmos números de `analysis/analise_atendimento.py`; 9 com produto diferente do pedido (ex.: "foto mostra necessaire, o pedido tem Connect Card").

*Os 9 anexos com "produto da foto diferente do pedido"* (para conferência manual). Todos também têm o mesmo hash em outro pedido ou cliente; 4 deles têm ainda EXIF anterior à entrega. Ou seja, nenhum dos 9 depende só da comparação de produto.

| anexo_id | conversa | pedido | descrição visual (resumida) | produto do pedido | regra que disparou |
| --- | --- | --- | --- | --- | --- |
| IMG000010 | AT104936 | GCH525527 | Necessaire estampada rasgada na costura | Connect Card Magsafe Personalizado Iniciais | categoria (necessaire × connect card) |
| IMG000021 | AT105239 | GCH526998 | Copo térmico de inox com pintura descascada e amassado | Garrafa Fresh 950ml Personalizada Iniciais | categoria (copo × garrafa) |
| IMG000074 | AT107296 | GCH532004 | Necessaire estampada com zíper arrebentado | Tote Bag Daily Personalizada Nome | categoria (necessaire × bolsa) |
| IMG000082 | AT107636 | GCH532504 | Capinha transparente com estampa rachada na lateral | Case Anti Impacto Slim Air / Samsung Galaxy A56 Personalizada Iniciais | estampa × personalização por iniciais |
| IMG000098 | AT108179 | GCH533082 | Necessaire estampada rasgada na costura | Mini Tote Personalizada Iniciais | categoria (necessaire × bolsa) |
| IMG000102 | AT108282 | GCH535148 | Copo térmico de inox com pintura descascada e amassado | Garrafa Urban 500ml Personalizada Iniciais | categoria (copo × garrafa) |
| IMG000209 | AT112299 | GCH544744 | Capinha transparente com estampa rachada na lateral | Case Guard Magsafe / iPhone 16 Pro Personalizada Iniciais | estampa × personalização por iniciais |
| IMG000236 | AT113281 | GCH547544 | Copo térmico de inox com pintura descascada e amassado | Garrafa Mini 350ml Personalizada Nome | categoria (copo × garrafa) |
| IMG000322 | AT115610 | GCH555045 | Necessaire estampada com zíper arrebentado | Necessaire Voyage Personalizada Nome | estampa × personalização por nome |

Pontos para a conferência: "copo × garrafa" depende de a descrição visual distinguir os dois (um copo térmico e uma garrafa térmica podem ser confundidos pelo módulo de visão); "estampa × personalização" supõe que nome e iniciais não aparecem como "estampa" na descrição.

**`lib/ferramentas`.** Uma função por ferramenta, com o nome de `ferramentas.csv` (26), e o registro `FERRAMENTAS` para chamar por nome. Nenhuma ação tem efeito real.

- Toda chamada passa pela mesma checagem: o papel do simulador (padrão `atendente`) precisa estar em `papeis_permitidos`; `valor_max_sem_aprovacao_rs` (R$ 200 reenvio/reimpressão/troca, R$ 100 reembolso; o valor exato passa); `somente_antes_da_separacao` (cancelar, alterar endereço); `max_por_dia` (300 notificações, contadas por pedido no dia). Acima do limite, a ação é recusada com "precisa aprovação de supervisor", a menos que traga um `aprovacao_id` aprovado para a mesma ação, o mesmo pedido e valor igual ou maior.
- `solicitar_aprovacao` cria a aprovação pendente; quem decide é `Simulador.decidirAprovacao`, usando `podeAprovar` da policy (só supervisor, nunca a própria ação). `aprovar_acao` não está na lista pedida, por isso fica como método do simulador.
- `sinalizar_suspeita` exige evidências, não envia nada ao cliente e suspende reenvio, reimpressão, troca e reembolso daquele pedido (`ferramentas.csv`).
- `responder_cliente` e `notificar_clientes` recusam texto com CPF, cartão, telefone ou e-mail. `alterar_endereco` não grava o endereço no log.
- O log segue as colunas de `acoes_executadas_sistemas.csv`, com `executado_por = "agente"` e referências simuladas (`OMS-SIM-…`, `EST-SIM-…`, `CHM-SIM-…`, `APR-SIM-…`, `SUS-SIM-…`). Consultas também entram no log, como `consultar_pedido` no log real, para medir os sistemas acessados. Ações recusadas não entram no log.
- Sistema de cada ação, como no log real: OMS (reenvio, troca), Sistema de produção Gocase (reimpressão), Gateway (reembolso, verificar pagamento), ERP (consulta, cancelamento, endereço), Plataforma de cupons, Portal da transportadora do pedido (status, chamado), Central de atendimento (mensagens, suspeita, aprovação, incidente, notificação) e Canal do time (acionar pessoa).

## Feedback recebido e ajustes

**Mentor (07/11):** temos autonomia para mudar políticas desde que melhorem as decisões; o foco é expandir a autonomia ao máximo, medindo, sem valoração fictícia; humano só como supervisor.

Ajustes feitos em resposta (seção 4):

- As políticas que limitam a autonomia viraram alavancas configuráveis (`CenarioPolitica` em `lib/policy/regras.ts`), com o vigente de `politicas.csv` preservado em `CENARIO_VIGENTE`.
- Cada alavanca foi medida sobre as 2.984 conversas do histórico pelo motor real (`app/scripts/simular-autonomia.ts`), só com parâmetros de `parametros.md` e dados medidos; o que é hipótese (p) é testado em três valores.
- O cenário padrão passou a ser o recomendado pela simulação.
- Para não medir com informação do futuro, `lib/contexto` passou a montar a ficha na data da conversa (status do pedido, eventos, cobranças, estornos, chamados, reenvios do OMS). Isso corrigiu um vazamento: o status "estornada" do gateway é a posição de 02/11 e fazia parecer já estornadas cobranças estornadas depois da conversa.

## 4. Simulação de autonomia e cenário recomendado

**Alavancas (`CenarioPolitica`).** `limiteReenvioRs` (vigente 200); `auditoriaAmostraPct` (0 = desligada; ligada, 10% dos casos de nível 0 executam e vão para revisão posterior a R$ 6 cada, sorteio determinístico pelo `conversation_id`); `estornoDuplicidadeSemTeto` (duplicidade comprovada no gateway e sem estorno: nível 0 sem o teto de R$ 100); `brindeSemFoto` (brinde faltante dispensa foto e vai direto à fórmula); `bloquearFotosConfirmadas` + `hashesBloqueados` (hash confirmado como fraude pelo supervisor → nível 2 antes de qualquer regra); `freioDiarioRs` (teto diário de R$ em ações autônomas com dinheiro; acima, nível 1; null = sem freio); `pSemSinal` (vigente 0,05). O simulador de ferramentas (`lib/ferramentas`) usa o mesmo cenário para o limite de reenvio e o estorno sem teto, para não divergir do motor.

**Método (`npm run simular`, em `app/`).** Lê `data/raw/atendimento` localmente e grava `data/processed/simulacao_autonomia.{json,csv}`. Para cada conversa: monta a ficha com `lib/contexto` na data da última mensagem do cliente; calcula os sinais com `lib/evidencias` usando só os anexos enviados até ali; decide com `lib/policy`. Conversas em ordem cronológica, para o freio diário e a lista de fotos bloqueadas evoluírem no tempo.

- *Motivo* = `tag_agente` mapeada: Rastreio→rastreio, Atraso→atraso, Avaria→avaria, Produto faltando→brinde se o pedido tem brinde e o cliente fala em brinde/mimo/necessaire (senão item_faltante), Troca→troca_fragrancia, Cancelamento→cancelamento, Reclamação produto→reacao_adversa se `lib/agent/sinais` detecta saúde, erro_personalizacao se o pedido é personalizado, senão outro; Financeiro→cobranca_duplicada se há 2+ cobranças efetivadas até ali, senão pagamento_pendente; Dúvida→duvida_produto; Promoção→cupom; Endereço→endereco; Elogio→elogio; Outros→outro; sem tag→sem_interacao (só bot, nível 1).
- *Valor da ação*: valor do pedido para reenvio, reimpressão, troca, cancelamento e atraso; custo do brinde no catálogo (R$ 24,90) para brinde; excedente das cobranças efetivadas para cobrança duplicada.
- *Escala*: por mês = amostra × 4 ÷ 3 (90 dias).

**Métricas.** % de nível 0/1/2; conversas e horas humanas liberadas por mês (nível 0, `minutos_trabalhados` de `tempo_por_conversa`); **custo de atendimento evitado** = custo por conversa do canal (`parametros.md`) das conversas de nível 0; **perda esperada** = Σ p × 0,45 × valor do pedido das reclamações com evidência resolvidas no nível 0; **fraudes esperadas** entre as reclamações com sinal forte = Σ p (0,90); **atrito** = Σ (1 − p) × R$ 6 dos casos sinalizados; **auditoria** = R$ 6 por caso sorteado; **saldo líquido** = custo evitado − perda − atrito − auditoria. A perda evitada pelas fraudes detectadas (R$ 1.068/mês) é informada, mas fica fora do saldo, porque não sabemos quanto o processo atual já barra.

**Limitações.** (1) O motivo é o rótulo humano (tag), não a saída do classificador, e a confiança é 1,0: a autonomia real depende da qualidade do classificador e do limiar de 0,7. (2) As tags são ruidosas ("Reclamação produto" mistura saúde, personalização e avaria). (3) Cancelamento e devolução não têm data nos dados: antes do corte, o pedido aparece como aguardando separação, em trânsito ou entregue. (4) A lista de fotos bloqueadas supõe que o supervisor confirma toda foto repetida sinalizada (limite superior do efeito). (5) Níveis 1 e 2 não contam economia, mesmo quando o agente prepara o caso. (6) O custo por conversa é o de `parametros.md`; o Reclame Aqui nunca chega ao nível 0, então seu custo de R$ 42 não entra no evitado.

**Resultados (por mês, escalados; p = probabilidade inicial sem sinal).**

| Cenário (cumulativo) | p | % N0 | % N1 | % N2 | conversas liberadas | horas liberadas | custo evitado | perda esperada | auditoria | saldo líquido |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 vigente | 0,02 | 51,1 | 48,0 | 0,9 | 2.035 | 366,5 | 11.164,80 | 183,57 | 0 | 10.968,43 |
| 1 vigente | 0,05 | 51,1 | 48,0 | 0,9 | 2.035 | 366,5 | 11.164,80 | 417,55 | 0 | 10.734,45 |
| 1 vigente | 0,10 | 49,7 | 49,4 | 0,9 | 1.976 | 354,1 | 10.832,00 | 361,36 | 0 | 10.457,84 |
| 2 + auditoria 10% | 0,05 | 51,1 | 48,0 | 0,9 | 2.035 | 366,5 | 11.164,80 | 417,55 | 1.096,00 | 9.638,45 |
| 3 + estorno sem teto | 0,05 | 51,5 | 47,6 | 0,9 | 2.048 | 368,5 | 11.241,60 | 417,55 | 1.096,00 | 9.715,25 |
| 4 + brinde sem foto | 0,05 | 51,4 | 47,7 | 0,9 | 2.047 | 368,2 | 11.235,20 | 466,84 | 1.096,00 | 9.659,56 |
| 5 + fotos bloqueadas | 0,05 | 51,4 | 47,7 | 0,9 | 2.047 | 368,2 | 11.235,20 | 466,84 | 1.096,00 | 9.659,56 |
| 6a + limite 300 | 0,05 | 51,7 | 47,4 | 0,9 | 2.059 | 370,8 | 11.302,40 | 527,48 | 1.104,00 | 9.658,12 |
| **6b + limite 500** | 0,02 | 52,0 | 47,1 | 0,9 | 2.071 | 373,6 | 11.372,80 | 266,02 | 1.104,00 | 9.989,98 |
| **6b + limite 500** | 0,05 | 51,7 | 47,4 | 0,9 | 2.059 | 370,8 | 11.302,40 | 527,48 | 1.104,00 | 9.658,12 |
| **6b + limite 500** | 0,10 | 49,6 | 49,5 | 0,9 | 1.975 | 353,5 | 10.825,60 | 361,36 | 1.048,00 | 9.403,44 |
| 7 + freio R$ 1.700/dia | 0,05 | 50,8 | 48,3 | 0,9 | 2.021 | 364,6 | 11.097,60 | 504,28 | 1.096,00 | 9.484,52 |

Tabela completa (todos os cenários × p, mais atrito, fraudes e auditados) em `data/processed/simulacao_autonomia.csv`. Em todos os cenários: 16 reclamações com sinal forte na amostra (19,2 fraudes esperadas por mês) e atrito de R$ 12,80/mês. Com p = 0,10, a perda cai em vez de subir porque a fórmula manda mais reclamações para o nível 1 (só 67 resolvidas no nível 0, contra 111 a 139 com p menor).

**Efeito isolado de cada alavanca** (sobre o vigente, p = 0,05, na amostra): estorno sem teto +10 conversas no nível 0 e +R$ 76,80/mês de saldo; limite 300 ou 500 +9 conversas, +R$ 6,56 de saldo e +R$ 60,64 de perda (com p = 0,05 a fórmula já barra pedidos acima de R$ 266,66, por isso 300 e 500 empatam; com p = 0,02 o 500 rende mais); brinde sem foto −1 conversa e −R$ 55,69 de saldo (pedidos acima de R$ 266,66 saem de `solicitar_foto`, nível 0, para o nível 1 pela fórmula, que usa o valor do pedido e não o do brinde); fotos bloqueadas 0 (toda foto que entraria na lista já é sinal forte pelo índice de hash, então a lista só valerá contra fotos que voltem depois de apagadas do histórico); freio de R$ 1.700/dia −18 conversas e −R$ 125,08; auditoria 0 conversas e −R$ 1.096/mês.

**Recomendado: cenário 6b** (limite de reenvio R$ 500, auditoria 10%, estorno de duplicidade sem teto, brinde sem foto, fotos bloqueadas, sem freio). Regra de escolha: maior % de nível 0 com p = 0,05 entre os cenários com saldo líquido positivo nos três valores de p; empate (6a e 6b com 51,7%) decidido pela maior autonomia média nos três p (6b: 51,1%). Saldo mínimo do 6b: R$ 9.403,44/mês (p = 0,10). Ficou como `CENARIO_PADRAO`. Observações:

- O ganho de autonomia das alavancas pedidas é pequeno: de 51,1% para 51,7% de nível 0 (de 2.035 para 2.059 conversas liberadas por mês). A auditoria custa R$ 1.096/mês e não muda o nível; o que ela compra é a medida de p (a taxa real de reclamações improcedentes entre as resolvidas sozinhas), que hoje é hipótese. Vale manter até p estar medido.
- Brinde sem foto entrou porque o cenário é cumulativo e a regra de escolha olha o total, mas isoladamente piora (−1 conversa, −R$ 55,69). Se o time preferir, desligar só essa alavanca do padrão.
- O freio não entrou porque reduz a autonomia (−18 conversas) e o saldo; fica disponível como proteção operacional se o gasto diário sair do padrão medido (p90 de R$ 1.669/dia).

**Onde está o resto da autonomia (causas do nível 1 no 6b, p = 0,05, 1.413 casos de nível 1 na amostra).** Conversas só de bot sem regra (330), motivo "outro" (242), Reclame Aqui (200), troca de fragrância sempre nível 1 (158), cancelamento sempre nível 1 (156), atraso acima de 7 dias úteis ou extravio (148), dúvida sem ficha ou sem pedido (71), rastreio de pedido já entregue (37 + 13 sem regra), custo esperado acima de R$ 6 (28), cobrança duplicada já estornada ou não confirmada (28). As alavancas com efeito grande são essas, não as simuladas: encerrar sem ação as conversas só de bot, permitir cancelamento antes da separação e troca de fragrância dentro das regras no nível 0, e classificar melhor o "outro". Cada uma muda política e precisa da mesma medição antes de entrar.

## 5. Direito comprovado por sistema e nova simulação

**Ajustes no padrão (após a seção 4).** Brinde sem foto **desligado** (piorou na simulação: −1 conversa e −R$ 55,69/mês); limite do atendente para reenvio/reimpressão **R$ 300** (mesmo efeito do R$ 500 com p = 0,05, menor risco); auditoria 10% e fotos bloqueadas ligadas; estorno de duplicidade sem teto mantido.

**Princípio:** *direito comprovado por sistema → nível 0 sem teto em R$ (até o valor do pedido); direito que depende de declaração do cliente → fórmula de custo.* O sistema que comprova é citado na justificativa, e o simulador de ferramentas confere o direito nos dados antes de dispensar o teto: não basta o agente declarar o motivo (`direitoComprovado` em `lib/ferramentas`).

| Regra | Comprovação | Nível 0 | Continua nível 1 |
| --- | --- | --- | --- |
| Cobrança duplicada (seção 4) | gateway: 2+ cobranças efetivadas, sem estorno | `reembolsar` sem teto, até o valor do pedido | não confirmada, já estornada ou acima do valor do pedido |
| Cancelamento/arrependimento antes da separação | ERP: `aguardando_separacao` e sem `data_separacao` | `cancelar_pedido` + `reembolsar` integral | depois da separação, separação desconhecida, acima do valor do pedido |
| Atraso > 7 dias úteis ou extravio | ERP/portal: data prometida + feriados, ou status `extraviado` | `reenviar_produto` ou `reembolsar` à escolha do cliente, até o valor do pedido | atraso desconhecido, acima do valor do pedido |
| Troca de fragrância | ERP/OMS: entregue há até 30 dias e 0 trocas no pedido | `trocar_produto` com coleta reversa; o novo item só sai depois de o CD conferir a devolução (até 20% usado) | mais de 30 dias, troca anterior, trocas desconhecidas, valor acima do limite de troca (R$ 200: a troca não é sem teto) |
| Reclame Aqui | — | a ação segue a regra do motivo | só a resposta pública (`responder_cliente`) precisa de aprovação |

- **Saída separada.** `decidirNivel` devolve `nivelAcao` (o que o agente executa; `nivel` é o mesmo valor) e `aprovacaoResposta` (true no Reclame Aqui). No vigente, o Reclame Aqui continua subindo a conversa inteira para o nível 1.
- **Freio diário como rede de segurança das regras sem teto.** Teto de R$ 3.000/dia, contado só nas ações sem teto executadas no nível 0 (`acaoSemTeto` na saída). A ação que passaria do teto vai para o nível 1. As ações pela fórmula (com o teto do atendente) não entram no freio.
- A confiança do classificador abaixo de 0,7 continua subindo qualquer ação, inclusive sem teto, para o nível 1.

**Nova simulação** (`npm run simular`; cenários somados um a um; o cenário 7 é conferido igual a `CENARIO_PADRAO`). Mudanças de medida em relação à seção 4:

- *Autonomia total* = ação no nível 0 **e** sem aprovação de resposta (nenhuma pessoa toca). Só ela conta conversas, horas e custo evitado. No Reclame Aqui com a ação no nível 0, a ação sai sem esperar, mas a resposta ainda passa por uma pessoa, então não conta economia.
- *Perda de reenvio por atraso* (medida): 0,45 × valor do pedido (`parametros.md`) quando o agente reenviou por atraso no nível 0 e o pedido original foi entregue depois (posição final de 02/11). Supõe que o cliente escolhe o reenvio; se escolher reembolso e o original chegar, a perda seria o valor do pedido.
- *Saldo comparável*: a política (vigente ou nova) manda reenviar depois de 7 dias úteis também no nível 1, e quem aprova não sabe se o original vai chegar. O saldo comparável desconta essa perda em qualquer nível, para não atribuir à autonomia um custo que é da política. O saldo líquido continua descontando só o que o agente executa sozinho (mais conservador).

| Cenário (cumulativo) | p | ação N0 | % autônomas | conversas/mês | horas/mês | custo evitado | perda | auditoria | saldo líquido | saldo comparável |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 vigente | 0,05 | 51,1% | 51,1% | 2.035 | 366,5 | 11.164,80 | 417,55 | 0 | 10.734 | 3.162 |
| 2 base ajustada (limite 300, auditoria, estorno sem teto, fotos bloqueadas) | 0,05 | 51,8% | 51,8% | 2.060 | 371,2 | 11.308,80 | 478,19 | 1.104 | 9.714 | 2.141 |
| 3 + cancelamento antes da separação | 0,05 | 53,6% | 53,6% | 2.131 | 384,1 | 11.686,40 | 478,19 | 1.144 | 10.051 | 2.479 |
| 4 + atraso comprovado | 0,05 | 58,4% | 58,4% | 2.324 | 419,4 | 12.745,60 | 6.687,35 | 1.264 | 4.781 | 3.418 |
| 5 + troca de fragrância | 0,05 | 60,5% | 60,5% | 2.405 | 435,0 | 13.216,00 | 6.687,35 | 1.344 | 5.172 | 3.809 |
| 6 + Reclame Aqui separa ação e resposta | 0,05 | 69,1% | 60,5% | 2.405 | 435,0 | 13.216,00 | 8.096,51 | 1.560 | 3.547 | 3.547 |
| **7 + freio R$ 3.000/dia (padrão)** | 0,02 | 68,8% | 60,3% | 2.399 | 434,0 | 13.184,00 | 7.178 | 1.552 | 4.442 | 3.811 |
| **7 + freio R$ 3.000/dia (padrão)** | 0,05 | 68,7% | 60,2% | 2.395 | 433,1 | 13.158,40 | 7.465,57 | 1.552 | 4.128 | 3.497 |
| **7 + freio R$ 3.000/dia (padrão)** | 0,10 | 66,8% | 58,4% | 2.324 | 418,0 | 12.758,40 | 7.341 | 1.520 | 3.884 | 3.253 |

Valores por mês, escalados (×4 ÷ 3). Todos os cenários têm saldo líquido e saldo comparável positivos nos três valores de p (tabela completa em `data/processed/simulacao_autonomia.csv`).

**Ganho de cada regra somada** (p = 0,05; diferença para o cenário anterior):

| Regra somada | conversas autônomas (amostra) | conversas/mês | horas/mês | perda/mês | saldo líquido/mês | saldo comparável/mês |
| --- | --- | --- | --- | --- | --- | --- |
| base ajustada | +19 | +25 | +4,7 | +60,64 | −1.020,64 | −1.020,64 |
| cancelamento antes da separação | +53 | +71 | +12,9 | 0 | +337,60 | +337,60 |
| atraso comprovado | +145 | +193 | +35,3 | +6.209,16 | −5.269,96 | +939,20 |
| troca de fragrância | +61 | +81 | +15,6 | 0 | +390,40 | +390,40 |
| Reclame Aqui separa (257 ações a mais no nível 0, resposta aprovada) | 0 | 0 | 0 | +1.409,16 | −1.625,16 | −261,99 |
| freio R$ 3.000 | −8 | −10 | −1,9 | −630,94 | +581,34 | −49,60 |

**Leitura.**

- O princípio é o que move a autonomia: as conversas sem nenhuma pessoa vão de 51,1% (vigente) para 60,2% no padrão (+360 conversas e +66,6 horas por mês), e as ações no nível 0 para 68,7%. As alavancas da seção 4 juntas somavam +0,7 ponto.
- **Atraso: achado medido.** Dos 178 reenvios por atraso no nível 0 do padrão (todos por atraso acima de 7 dias úteis; nenhum por extravio já confirmado no momento da decisão), em **115 (65%) o pedido original foi entregue depois**. Isso custa R$ 7.572/mês na política como está (vigente incluído, quando a pessoa aprova o mesmo reenvio). Não é custo da autonomia: no saldo comparável, a regra de atraso no nível 0 rende +R$ 939/mês. Mas sugere rever a política de atraso, por exemplo reenviar no nível 0 só com extravio confirmado pela transportadora (resposta do chamado) e, no atraso sem extravio, abrir o chamado e esperar a resposta antes de reenviar. Precisa da mesma medição antes de mudar.
- **Reclame Aqui separado** não libera horas (a resposta pública continua com uma pessoa), mas tira 257 ações da fila de espera (o reenvio ou o estorno sai na hora). O custo medido (+R$ 1.409/mês de perda) vem do reenvio por atraso, que agora sai no nível 0 também no Reclame Aqui; no saldo comparável o efeito é −R$ 262/mês (auditoria e perda pela fórmula).
- **Freio de R$ 3.000/dia.** Gasto sem teto no padrão: R$ 38.348/mês; por dia, p90 R$ 2.741 e máximo R$ 3.248 (escalados). O freio atuou em 4 dias (10 casos da amostra), custa −10 conversas/mês e −R$ 49,60/mês no saldo comparável. Fica ligado como rede de segurança: limita o pior dia sem mexer no dia típico.
- **O que ainda está no nível 1 da ação** (padrão, p = 0,05, amostra): conversas só de bot sem regra (330), "outro" (242), cancelamento depois da separação (95), troca fora das condições (77), dúvida sem ficha ou sem pedido (71), cobrança duplicada já estornada ou não confirmada (28), custo esperado acima de R$ 6 (27), rastreio de pedido entregue sem regra (13), limite do atendente (11), freio (10). As duas primeiras linhas (572 casos, 19% da amostra) dependem do classificador e de uma regra para conversa sem interação, não de valor em R$.
- **Limitações** (além das da seção 4): o reenvio por atraso supõe que o cliente escolhe o reenvio; cancelamento antes da separação e troca com conferência do CD não têm perda modelada; "entregue depois" usa a posição final de 02/11.
