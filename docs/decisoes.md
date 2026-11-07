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

**Removido** (específico do projeto anterior): `lib/faq`, `lib/acoes`, `lib/demo` (exemplos, gravações e contingência), `lib/impacto` (números de outra base; fica um stub que vai ler `data/processed/metricas.json`), o pipeline de `lib/agent` (cliente Groq, esquema, prompts, checagem), os componentes da página, a rota `api/agent`, os scripts `smoke` e `avaliar-classificador` e a dependência `groq-sdk`. O LLM agora é o AI Proxy da Gogroup (Jev + chat completions) e o pipeline será reescrito para ele; a rota `api/agent` volta quando houver pipeline para injetar. A página é provisória.

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
- *Motivos fora da tabela* (`sem_interacao`, `outro`): nível 1 até o time definir. Pendente de decisão: só nas conversas só de bot (`sem_interacao`) seriam 330 na amostra. Decidido na seção 7: `sem_demanda`, nível 0.

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

| Cenário (cumulativo) | p | ações executadas sozinho (N0) | sem nenhuma pessoa (todas) | sem nenhuma pessoa (sem as sem demanda) | conversas/mês | horas/mês | custo evitado | perda | auditoria | saldo líquido | saldo comparável |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 vigente | 0,05 | 62,2% | 62,2% | 57,5% | 2.033 | 366,4 | 11.158,40 | 459,17 | 0 | 10.686 | 3.114 |
| 2 base ajustada (limite 300, auditoria, estorno sem teto, fotos bloqueadas) | 0,05 | 62,8% | 62,8% | 58,2% | 2.060 | 371,2 | 11.308,80 | 526,11 | 1.104 | 9.666 | 2.094 |
| 3 + cancelamento antes da separação | 0,05 | 64,6% | 64,6% | 60,2% | 2.131 | 384,1 | 11.686,40 | 526,11 | 1.144 | 10.003 | 2.431 |
| 4 + atraso comprovado | 0,05 | 69,5% | 69,5% | 65,7% | 2.324 | 419,4 | 12.745,60 | 6.735,27 | 1.264 | 4.734 | 3.370 |
| 5 + troca de fragrância | 0,05 | 71,5% | 71,5% | 68,0% | 2.405 | 435,0 | 13.216,00 | 6.735,27 | 1.344 | 5.124 | 3.761 |
| 6 + Reclame Aqui separa ação e resposta | 0,05 | 79,9% | 71,5% | 68,0% | 2.405 | 435,0 | 13.216,00 | 8.171,71 | 1.552 | 3.479 | 3.479 |
| **7 + freio R$ 3.000/dia (padrão)** | 0,02 | 79,7% | 71,3% | 67,8% | 2.399 | 434,0 | 13.184,00 | 7.211,83 | 1.544 | 4.415 | 3.784 |
| **7 + freio R$ 3.000/dia (padrão)** | 0,05 | 79,6% | 71,2% | 67,7% | 2.395 | 433,1 | 13.158,40 | 7.540,78 | 1.544 | 4.061 | 3.430 |
| **7 + freio R$ 3.000/dia (padrão)** | 0,10 | 77,4% | 69,4% | 65,6% | 2.320 | 417,3 | 12.732,80 | 7.416,24 | 1.512 | 3.792 | 3.161 |

Valores por mês, escalados (×4 ÷ 3); atualizados depois da correção da seção 6 (dias desde o recebimento contados até a reclamação) e da regra de conversa sem demanda da seção 7 (as 330 conversas sem mensagem do cliente passam ao nível 0 em todos os cenários, sem hora nem custo evitado; por isso as duas colunas de "sem nenhuma pessoa"). Todos os cenários têm saldo líquido e saldo comparável positivos nos três valores de p (tabela completa em `data/processed/simulacao_autonomia.csv`).

**Ganho de cada regra somada** (p = 0,05; diferença para o cenário anterior):

| Regra somada | conversas autônomas (amostra) | conversas/mês | horas/mês | perda/mês | saldo líquido/mês | saldo comparável/mês |
| --- | --- | --- | --- | --- | --- | --- |
| base ajustada | +20 | +27 | +4,8 | +66,94 | −1.020,54 | −1.020,54 |
| cancelamento antes da separação | +53 | +71 | +12,9 | 0,00 | +337,60 | +337,60 |
| atraso comprovado | +145 | +193 | +35,3 | +6.209,16 | −5.269,96 | +939,20 |
| troca de fragrância | +61 | +81 | +15,6 | 0,00 | +390,40 | +390,40 |
| Reclame Aqui separa (251 ações a mais no nível 0, resposta aprovada) | 0 | 0 | 0,0 | +1.436,44 | −1.644,44 | −281,27 |
| freio R$ 3.000 | −8 | −10 | −1,9 | −630,93 | +581,33 | −49,60 |

**Leitura.**

- O princípio é o que move a autonomia: sem contar as conversas sem demanda, as conversas sem nenhuma pessoa vão de 57,5% (vigente) para 67,7% no padrão (+362 conversas e +66,7 horas por mês), e as ações executadas sozinho para 79,6%. Antes da regra de conversa sem demanda (seção 7) os mesmos números eram 51,1% → 60,2% sobre todas as conversas: as 330 sem demanda entravam no denominador e no nível 1. As alavancas da seção 4 juntas somavam +0,7 ponto.
- **Atraso: achado medido.** Dos 178 reenvios por atraso no nível 0 do padrão (todos por atraso acima de 7 dias úteis; nenhum por extravio já confirmado no momento da decisão), em **115 (65%) o pedido original foi entregue depois**. Isso custa R$ 7.572/mês na política como está (vigente incluído, quando a pessoa aprova o mesmo reenvio). Não é custo da autonomia: no saldo comparável, a regra de atraso no nível 0 rende +R$ 939/mês. Mas sugere rever a política de atraso, por exemplo reenviar no nível 0 só com extravio confirmado pela transportadora (resposta do chamado) e, no atraso sem extravio, abrir o chamado e esperar a resposta antes de reenviar. Precisa da mesma medição antes de mudar.
- **Reclame Aqui separado** não libera horas (a resposta pública continua com uma pessoa), mas tira 257 ações da fila de espera (o reenvio ou o estorno sai na hora). O custo medido (+R$ 1.436/mês de perda) vem do reenvio por atraso, que agora sai no nível 0 também no Reclame Aqui; no saldo comparável o efeito é −R$ 281/mês (auditoria e perda pela fórmula).
- **Freio de R$ 3.000/dia.** Gasto sem teto no padrão: R$ 38.348/mês; por dia, p90 R$ 2.741 e máximo R$ 3.248 (escalados). O freio atuou em 4 dias (10 casos da amostra), custa −10 conversas/mês e −R$ 49,60/mês no saldo comparável. Fica ligado como rede de segurança: limita o pior dia sem mexer no dia típico.
- **O que ainda está no nível 1 da ação** (padrão, p = 0,05, amostra): conversas só de bot sem regra (330; resolvido na seção 7: nível 0 sem economia), "outro" (242), cancelamento depois da separação (95), troca fora das condições (77), dúvida sem ficha ou sem pedido (71), cobrança duplicada já estornada ou não confirmada (28), custo esperado acima de R$ 6 (33), rastreio de pedido entregue sem regra (13), limite do atendente (11), freio (10). As duas primeiras linhas (572 casos, 19% da amostra) dependem do classificador e de uma regra para conversa sem interação, não de valor em R$.
- **Limitações** (além das da seção 4): o reenvio por atraso supõe que o cliente escolhe o reenvio; cancelamento antes da separação e troca com conferência do CD não têm perda modelada; "entregue depois" usa a posição final de 02/11.

## 6. Agente de ponta a ponta (Jev, redação checada, orquestrador, analista)

**AI Proxy.** Formato OpenAI, por `fetch` (`lib/agent/cliente.ts`), com `AI_PROXY_BASE_URL`, `AI_PROXY_API_KEY` e `AI_PROXY_MODEL` (`gpt-6-luna`) só no `.env.local`. O esquema do Jev (`POST /systemone`) não estava documentado no repositório; foi descoberto pelas mensagens de validação do próprio proxy, com texto fictício, e está no topo de `cliente.ts`:

- `questions` é um objeto `{ id: pergunta }`, e a pergunta tem `type`;
- `choice`: `criteria` = `{ opção: descrição }` → `choice`, `confidence`, `probabilities`;
- `score`: `criteria` = lista de níveis → `score`, `confidence`, `probabilities` por índice;
- `noul`: `instructions` = pergunta de sim/não → `noul` (probabilidade de "sim");
- `usage.estimated_cost_usd` vem no Jev; o chat devolve só tokens, e por isso o custo do chat não é estimado (não inventamos preço).

**Classificador (`lib/agent/classificador.ts`).** Uma chamada ao Jev por conversa, só com as mensagens do cliente e o assunto, **mascarados** (`lib/pii`). Perguntas: `motivo` (choice com a taxonomia de `lib/policy` e uma descrição curta de cada motivo, em `taxonomia.ts`), `urgencia` (score baixa/média/alta; vale o nível mais provável) e seis `noul` (reação adversa, menção de saúde, ameaça de Reclame Aqui ou Procon, cliente irritado, pede ou envia dado sensível, mais de um motivo; sim quando >= 0,5). Regras do código sobre a saída:

- sem mensagem do cliente → `sem_demanda` (antes `sem_interacao`; seção 7), sem chamar o Jev;
- reação adversa >= 0,5 prevalece sobre o motivo escolhido (sempre nível 2);
- menção de saúde = Jev ou o detector por palavra-chave;
- motivo fora da taxonomia → `outro` com confiança 0;
- a confiança < 0,7 → nível 1 é a regra que já existia no motor;
- timeout de 10 s ou falha → classificação inválida → **nível 2 com `falha_classificador`** e `acionar_pessoa`;
- erro transitório (rede, HTTP 429 ou 5xx) tem **uma** nova tentativa depois de 1,5 s. Timeout não repete, para respeitar os 10 s. Motivo: na avaliação, o proxy devolveu HTTP 429 (limite de requisições) em 10 de 348 chamadas numa rodada e em 95 de 348 na seguinte, com concorrência 5; todas foram recuperadas depois da janela de limite. **Risco operacional para o evento**: num pico, parte das conversas pode cair em nível 2 por limite do proxy.

**Redator (`lib/agent/redator.ts`) e checagem (`lib/agent/checagem.ts`).** `POST /chat/completions` recebe só os FATOS da ficha (sem dados pessoais), a AÇÃO decidida pelo motor (dizendo se já foi executada) e as mensagens do cliente mascaradas e entre delimitadores (texto do cliente é dado). A checagem foi reaproveitada de `../_referencia/app/src/lib/agent/checagem.ts`; a "FAQ usada" virou o texto permitido (descrição da ação, justificativa com a regra e fatos). Reprova: número, data ou valor sem fonte; número por extenso; dado pessoal (pelo padrão de `lib/pii` ou pela palavra); link sem fonte; **acusação** (fraude, suspeita, má-fé...); **lei, artigo ou CDC sem fonte**; termo de solução ou prazo que não está no texto permitido (ex.: falar em reembolso quando a ação é reenvio); promessa de contato no nível 0; e, quando a ação não foi executada, compromisso e "ação já feita". No nível 0 com a ação executada, o texto pode dizer o que foi feito. Reprovou: uma nova tentativa com o motivo da recusa; reprovou de novo ou o modelo falhou: `TEXTO_RESERVA` e a resposta vai para aprovação (nível 1). Caso sinalizado: a mensagem é a fixa "em análise", sem modelo.

**Orquestrador (`lib/agent/orquestrador.ts`).** `processarConversa(conversation_id)`: `ler_conversa` → `consultar_pedido` / `consultar_cliente` → `ver_anexos` → Jev → `verificar_pagamento` (só para motivo financeiro: depende do motivo, por isso vem depois da classificação) → evidências → `decidirNivel` → ação → redação → `responder_cliente` ou rascunho (`solicitar_aprovacao` da resposta) → `encerrar_conversa` quando a ação está completa e não se espera nada do cliente. Detalhes de decisão:

- nível 0 executa a ferramenta; se a ferramenta recusar (alçada), a ação vai para `solicitar_aprovacao` e o caso para o nível 1;
- atraso comprovado (reenvio ou reembolso à escolha do cliente): o agente reembolsa se o texto do cliente pede reembolso ou estorno, senão reenvia;
- cancelamento antes da separação: `cancelar_pedido` + `reembolsar` integral;
- nível 1: `solicitar_aprovacao` da ação, com a justificativa do motor; a resposta vai junto como rascunho;
- nível 2: `sinalizar_suspeita` (com as evidências), reação adversa (`orientar_suspensao_uso` + `acionar_pessoa` da qualidade para a cosmetovigilância em 24 h; `registrar_cosmetovigilancia` é do supervisor) ou `acionar_pessoa` (supervisão);
- Reclame Aqui: resposta sempre para aprovação (`aprovacaoResposta`), mesmo com a ação no nível 0;
- `alterar_endereco` no nível 0 é registrado sem o endereço (que está na conversa e é dado pessoal); a extração do endereço fica para a pessoa ou para um passo futuro;
- devolve `{ classificacao, ficha, sinais, decisao (com nivelFinal e ajustes), acoes, log, resposta, telemetria }`, com tokens, ms e custo estimado (Jev).

**Correção feita no caminho (`lib/contexto`).** Os dias desde o recebimento passaram a ser contados até a **reclamação** (abertura da conversa), não até a resposta: a política fala em "até 7 dias do recebimento", e uma conversa aberta no prazo não pode ser negada porque ficou na fila. Se a conversa começou antes da entrega, conta até agora. O verificador de evidências já usava a abertura. A simulação foi refeita (tabelas da seção 5 atualizadas; efeito pequeno: padrão com 68,5% das ações no nível 0 e 60,2% autônomas).

**Agente analista (`lib/agent/analista.ts`).** `detectarIncidentes()` lê os agregados de `data/processed` (exportados para `app/src/dados/agregados.json`) e os pedidos ainda abertos afetados (`pedidos_afetados.json`: só identificadores, situação e consentimentos), com papel `analista`:

- regras medidas: transportadora × UF com recontato >= 2× o das demais transportadoras e >= 30 conversas; brinde com >= 25% das conversas dos pedidos com brinde sendo "Produto faltando";
- resultado: `INC-SIM-000001` **Expressa Já: CE, BA, PB, PE, RN** e `INC-SIM-000002` **Mimo de Outubro GoBeauté: brinde não enviado**;
- avisos (`notificar_clientes`): só pedidos abertos afetados, com consentimento de WhatsApp ou e-mail no CRM; um pedido afetado pelos dois incidentes recebe um aviso só; no máximo 300 por dia somando os incidentes (o que passar fica preparado para os dias seguintes). Na base: 188 pedidos abertos da Expressa Já (6 sem consentimento) e 115 com brinde (7 sem consentimento); avisos de hoje: 182 + 88. Os pedidos fora da fila são da amostra de 1 em 4: no volume real seriam cerca de 4 vezes mais, e o limite de 300/dia espalharia os avisos por vários dias;
- os textos não prometem prazo nem solução ("se a necessaire não vier, responda com uma foto").

**Lote da fila (`npm run processar-fila`, 02/11 08:00, padrão, concorrência 5) → `data/processed/fila_resultado.json`.** Grava estrutura, decisão, log e a resposta já checada; nenhum texto do cliente.

| Métrica | Valor |
| --- | --- |
| conversas processadas | 65 de 65 (erros: 0) |
| ação no nível 0 / 1 / 2 | 83,1% / 15,4% / 1,5% |
| respostas enviadas sem pessoa / para aprovação | 33 / 32 (24 do Reclame Aqui) |
| redação aprovada na 2ª tentativa / texto de reserva | 11 / 1 |
| classificação inválida / confiança < 0,7 | 0 / 2 |
| sistemas acessados por conversa | 3,35 (no histórico humano: 1,83) |
| tempo médio por conversa / lote inteiro | 3,4 s / 49 s |
| custo de IA (Jev) | US$ 0,0026; chat: 29.844 tokens de entrada e 3.498 de saída (custo não informado pelo proxy) |

Ações por ferramenta: ler_conversa 65, consultar_cliente 65, ver_anexos 65, consultar_pedido 59, solicitar_aprovacao 42, responder_cliente 33, encerrar_conversa 28, solicitar_foto 12, informar_status 9, abrir_chamado_transportadora 6, negar_por_politica 6, validar_cupom 4, verificar_pagamento 4, reembolsar 3, reenviar_produto 2, alterar_endereco 1, orientar_suspensao_uso 1, acionar_pessoa 1, trocar_produto 1. A fila tem muito atraso e brinde (motivos com direito comprovado ou regra clara), por isso o nível 0 da ação é maior que na simulação sobre o histórico. As 7 decisões de negativa por prazo (6 executadas e 1 de cancelamento preparada para aprovação) foram conferidas: os clientes reclamaram de 10 a 25 dias depois da entrega.

**Avaliação do Jev (`npm run avaliar-jev`) → `data/processed/avaliacao_jev.json`.** Modelo `jev-1.14.0`; 348 chamadas, US$ 0,0149.

- *Amostra estratificada de 120* (semente 20261107; mesma quantidade por tag, porque as 330 sem tag não têm mensagem do cliente): concordância com a tag do atendente de **59,2%** (com o motivo mapeado da simulação, 55,8%).

| Tag | n | concordância |
| --- | --- | --- |
| Atraso | 10 | 70,0% |
| Avaria | 10 | 40,0% |
| Cancelamento | 9 | 44,4% |
| Dúvida | 9 | 77,8% |
| Elogio | 9 | 100,0% |
| Endereço | 9 | 66,7% |
| Financeiro | 9 | 88,9% |
| Outros | 9 | 11,1% |
| Produto faltando | 9 | 100,0% |
| Promoção | 9 | 88,9% |
| Rastreio | 10 | 50,0% |
| Reclamação produto | 9 | 22,2% |
| Troca | 9 | 11,1% |

- A tag é ruidosa: "Troca", "Outros" e "Reclamação produto" misturam assuntos (o Jev lê "Troca" como dúvida, avaria, brinde; "Reclamação produto" como avaria, atraso). "Cancelamento" lido como atraso é provavelmente o cliente que quer cancelar por causa do atraso (multi-motivo); "Rastreio" lido como atraso depende de o prazo já ter passado. Por isso a concordância não é acurácia: os desencontros precisam de revisão manual.
- **Revisão manual dos 20 desencontros de maior confiança** (tabela abaixo). Mauro revisou à mão, com apoio de IA, lendo as mensagens e o status do pedido: **o Jev acertou os 20** (`AT114627` tem dois motivos: atraso/extravio e cancelamento). Nesta revisão, os desencontros de alta confiança são erros da tag humana; os 59% de concordância medem o ruído da tag, não a acurácia do Jev. **Acurácia mínima na amostra de 120: 76%** (71 concordâncias + 20 revisados com o Jev certo = 91 de 120); os outros 29 desencontros não foram revisados. 40 dos 49 desencontros têm confiança >= 0,9; a revisão indica que a confiança alta acompanha acerto, não erro, mas o limiar de 0,7 não foi testado nos 29 restantes, e a segurança continua nas regras do motor (fatos de sistema, evidência, limites).
- **Achado de segurança**: `AT107397` é uma reação adversa ("rosto vermelho e ardendo" depois do sérum) registrada como "Avaria" pelo atendente. Pela tag, o caso seguiria como avaria, sem cosmetovigilância; o Jev o lê como `reacao_adversa` (1,00), o que leva o caso ao nível 2 com orientação de suspensão e registro em 24 h.
- *As 572 "sem_interacao" ou "outro" da simulação*: 330 não têm mensagem do cliente (só o bot falou): nada a classificar; viraram `sem_demanda` na seção 7 (o JSON da avaliação, gerado antes, ainda traz o nome antigo em `motivo_simulacao`). Das 242 com mensagem, o Jev dá motivo específico a 235 (atraso 60, avaria 39, rastreio 34, item_faltante 18, duvida_produto 14, cupom 11, brinde 11, troca_fragrancia 10, reacao_adversa 8, cobranca_duplicada 8, cancelamento 8, endereco 7, outro 7, elogio 3, erro_personalizacao 2, pagamento_pendente 2), com confiança >= 0,9 em 197.
- *Simulação com essa reclassificação* (cenário 8 = política do padrão, motivo e confiança do Jev nas 242 "outro"; `simulacao_autonomia.*`): conversas autônomas **65,4%** (padrão: 60,2%), 2.603 conversas e 470,4 horas por mês, saldo líquido de R$ 4.776/mês com p = 0,05 e positivo nos três p. O nível 2 sobe para 1,2% porque o Jev achou reações adversas que estavam em "outro".

*20 desencontros revisados à mão* (os de maior confiança; sem texto do cliente). Resultado da revisão: o Jev acertou os 20; `AT114627` tem dois motivos (atraso/extravio e cancelamento); `AT107397` é reação adversa registrada como avaria.

| conversa | tag do atendente | motivo do Jev | confiança |
| --- | --- | --- | --- |
| AT105029 | Atraso | rastreio | 1,00 |
| AT109431 | Avaria | item_faltante | 1,00 |
| AT107906 | Avaria | item_faltante | 1,00 |
| AT115773 | Avaria | brinde | 1,00 |
| AT107397 | Avaria | reacao_adversa | 1,00 |
| AT105583 | Cancelamento | atraso | 1,00 |
| AT106167 | Cancelamento | atraso | 1,00 |
| AT114627 | Cancelamento | atraso | 1,00 |
| AT111783 | Cancelamento | atraso | 1,00 |
| AT116017 | Financeiro | cupom | 1,00 |
| AT112433 | Outros | atraso | 1,00 |
| AT113975 | Outros | item_faltante | 1,00 |
| AT114565 | Outros | item_faltante | 1,00 |
| AT111126 | Outros | rastreio | 1,00 |
| AT111772 | Outros | cobranca_duplicada | 1,00 |
| AT110382 | Outros | item_faltante | 1,00 |
| AT106712 | Rastreio | atraso | 1,00 |
| AT107642 | Reclamação produto | atraso | 1,00 |
| AT116143 | Reclamação produto | avaria | 1,00 |
| AT108759 | Reclamação produto | atraso | 1,00 |

(Tabela acima: rodada da seção 6. O lote foi refeito na seção 7.)

**Casos de demonstração (`npm run casos-demo`, refeitos na seção 7 com o mesmo resultado de nível e ação; as respostas abaixo são as da nova rodada) → `data/processed/casos_demo.json`.** A fila não tem anexos; os três casos vêm do histórico, escolhidos por critério fixo (a primeira conversa, em ordem cronológica, que atende ao critério; fora do Reclame Aqui) e rodam pelo orquestrador real na data da conversa, com o índice de hash só até aquele momento:

1. *Avaria sem sinal*: `AT104667` (whatsapp, tag Avaria): Jev `item_faltante` (1,00); sinais: nenhum; nível 0 → `reenviar_produto`; resposta enviada: "Fizemos o reenvio do produto Creme de Pentear Cachos Definidos 1kg, sem custo, referente ao pedido GBH366247."
2. *Foto repetida de outro cliente*: `AT108179` (whatsapp, tag Avaria): Jev `avaria` (0,93); sinais: hash_em_outro_pedido_ou_cliente, produto_da_foto_diferente_do_pedido; nível 2 → `sinalizar_suspeita`; resposta enviada: "Recebemos sua solicitação e ela está em análise. Retornamos em até 24 horas com a solução."
3. *Reação adversa*: `AT106482` (whatsapp, tag Reclamação produto): Jev `reacao_adversa` (1,00); sinais: nenhum; nível 2 → `registrar_cosmetovigilancia`; resposta para aprovação: "Sinto muito que você esteja passando por isso. Pare de usar o produto e procure atendimento médico se precisar. Uma pessoa da equipe de qualidade vai cuidar do seu caso."

**Limitações.** A tag do atendente é a referência disponível, mas é ruidosa; 29 desencontros da amostra continuam sem revisão manual. O custo do chat não é informado pelo proxy. O limite de requisições do proxy (HTTP 429) é o principal risco operacional. `alterar_endereco` registra a alteração sem extrair o endereço. A rota `api/agent` foi ligada ao orquestrador na seção 7.

## 7. Conversa sem demanda, rota ligada ao orquestrador e grafia

**Conversa sem demanda.** Conversa sem nenhuma mensagem do cliente (só o bot falou) → motivo `sem_demanda`, **nível 0**, `encerrar_conversa`, sem resposta ao cliente e sem chamar o modelo. Fonte: `politicas.csv › categorias › sem_interacao` ("Conversa em que o cliente não escreveu nada"; ação permitida: `encerrar_sem_acao`). Como a única ação permitida é encerrar, não há o que uma pessoa decidir, e a regra vale em todos os cenários (não é alavanca). Também não entra no sorteio da auditoria. Na simulação, a definição passou a ser a ausência de mensagem do cliente (antes era a tag vazia; são as mesmas 330 conversas da amostra).

- **Zero hora economizada.** O bot já encerrava essas conversas: elas contam como "sem nenhuma pessoa", mas não somam conversas/mês liberadas, horas nem custo evitado.
- **Por isso, duas medidas.** "Conversas sem nenhuma pessoa" com todas as conversas no denominador e sem as conversas sem demanda (numerador e denominador). A segunda é a que mede o ganho real.

| p = 0,05 (mês = amostra × 4 ÷ 3) | vigente | nova política (padrão) |
| --- | --- | --- |
| conversas sem nenhuma pessoa, todas no denominador | 62,2% | 71,2% |
| conversas sem nenhuma pessoa, sem as sem demanda | 57,5% | 67,7% |
| ações executadas sozinho (nível 0 da ação) | 62,2% | 79,6% |
| horas liberadas por mês | 366,4 | 433,1 |
| conversas liberadas por mês (com demanda) | 2.033 | 2.395 |

*Conversas sem nenhuma pessoa* × *ações executadas sozinho*: a diferença é a resposta pública do Reclame Aqui. Na nova política, a ação do Reclame Aqui (reenvio, estorno) sai no nível 0, mas a resposta pública passa por uma pessoa; a ação conta como executada sozinho, e a conversa não conta como sem nenhuma pessoa.

**Rota `POST /api/agent` ligada ao orquestrador** (`app/src/app/api/agent/route.ts` → `lib/rota/handler.ts` → `lib/agent/servico.ts` → `processarConversa`):

- *Entrada*: `{ conversation_id, mensagem? }`. Sem mensagem, processa a conversa da fila. Com mensagem fictícia (até 2.000 caracteres), cria a conversa `TESTE-<id>` ligada ao pedido e ao cliente da conversa escolhida, só com o texto digitado (sem as mensagens e anexos originais), e esse texto vai mascarado ao Jev como qualquer outro.
- *Saída*: o mesmo resumo gravado em `fila_resultado.json` (`lib/agent/resumo.ts`, movido de `scripts/`), agora com as probabilidades do Jev e os sinais `noul`.
- *Concorrência máxima 2*: um semáforo por instância; as demais requisições esperam na ordem de chegada. Motivo: o 429 apareceu com concorrência 5 (seção 6).
- *Nova tentativa no 429*: o classificador já repetia; agora a redação também repete uma vez (429, 5xx ou rede, depois de 1,5 s), na rota e nos scripts `processar-fila` e `casos-demo`.
- *Contingência*: se o Jev falha (429, timeout, indisponível, sem configuração) ou o limite de requisições estoura, a rota devolve o resultado gravado da conversa no lote da fila, com `contingencia.aviso` para a tela ("Resultado gravado no lote da fila (motivo)"; com mensagem fictícia, avisa que ela não foi processada).
- *Mantido de `lib/rota`*: mesma origem, corpo até 10 KB, 10 requisições/minuto e 100/dia por IP, 300/dia no total, log só com métricas. A chave do AI Proxy só existe no servidor.
- `app/src/dados/processados/` recebe, por `npm run copiar-dados`, os arquivos de `data/processed` que a rota e a interface usam (`fila_resultado`, `casos_demo`, `simulacao_autonomia`, `avaliacao_jev`, `metricas`): só estrutura e respostas já checadas, sem texto do cliente.

**Lote da fila e casos de demo refeitos** (as 5 conversas da fila sem demanda e o resumo com probabilidades), com a nova tentativa no 429 também na redação:

| Métrica | seção 6 | seção 7 |
| --- | --- | --- |
| ação no nível 0 / 1 / 2 | 83,1% / 15,4% / 1,5% | 90,8% / 7,7% / 1,5% |
| sem demanda (nível 0, sem resposta) | — (nível 1) | 5 |
| respostas enviadas sem pessoa / para aprovação | 33 / 32 | 33 / 27 |
| redação aprovada na 2ª tentativa / texto de reserva | 11 / 1 | 15 / 1 |
| classificação inválida / confiança < 0,7 | 0 / 2 | 0 / 2 |
| tempo médio por conversa / lote inteiro | 3,4 s / 49 s | 3,2 s / 43 s |
| custo de IA (Jev) | US$ 0,0026 | US$ 0,0026 |

Os incidentes e avisos do analista não mudaram (182 + 88 avisos hoje). Os três casos de demo mantêm nível e ação.

**Grafia.** "Gogroup" (brandbook): corrigido em código, docs e na página; regra nas Convenções do CLAUDE.md. Nomes de arquivo e dados da organização ficam como vieram.

## 8. Interface

Página única (`app/src/app/page.tsx`) com sete abas (`_componentes/`). Os dados são montados no servidor por `lib/painel/dados.ts`, só a partir de `data/processed` (copiado por `npm run copiar-dados` para `app/src/dados/processados/`), da base da fila e da rota do agente. Cada número leva a fonte na tela.

- **Identidade visual (brandbook Gogroup).** Fonte Poppins (`next/font/google`; ExtraBold nos títulos, SemiBold nos subtítulos). Azul #005CAC dominante, limão #D7D900 nas etiquetas de título em pílula, cartões creme #F5F5F5 com texto azul, ciano #3DBFEF onde entra o modelo. Níveis: 0 azul, 1 laranja #F8AE13, 2 vermelho #E5381A.
- **Contraste.** O texto sobre o limão é azul-escuro #003A6E (7,6:1); nunca há texto branco sobre amarelo. O laranja tem contraste baixo com o branco (1,85:1, medido com o validador de paleta), por isso o nível nunca aparece só pela cor: o número vai dentro do círculo, o rótulo "Nível N" vem ao lado em texto escuro, e o gráfico tem legenda, rótulo direto e tabela equivalente.
- **Visão geral.** O problema em 4 números (`metricas.json`) e o resultado com os nomes exatos "conversas sem nenhuma pessoa" e "ações executadas sozinho" (`simulacao_autonomia.json`), explicando a diferença (resposta pública do Reclame Aqui). Também traz as horas liberadas, os casos com sinal forte sinalizados (16 na amostra, 21 por mês) e o diagrama do fluxo.
- **Fila de agora.** As 65 conversas em ordem de prioridade: SLA estourado primeiro, depois o menor SLA restante (`fila_conversas.csv`). O botão "Processar a fila" anima o resultado gravado do lote real, sem chamar o modelo de novo. Clicar numa linha abre a ficha do caso: classificação, ficha única com a origem de cada campo, sinais de evidência, decisão com a regra citada, linha do tempo das ferramentas e a resposta enviada ou o rascunho para aprovação.
- **Casos do histórico, Agente analista, Autonomia e Como conferimos a IA.** Os casos vêm de `casos_demo.json`, no mesmo formato da ficha. O analista é calculado no servidor por `detectarIncidentes()`. A Autonomia tem a recomendação nº 1 (reenvio por atraso). A aba de conferência traz a revisão manual do Jev (`lib/painel/revisao.ts`, julgamento humano registrado) e os 9 anexos, de `anexos_conferidos.json`, gerado por `npm run anexos-conferidos` a partir do verificador.
- **Analista: terceiro incidente.** Cobranças em dobro sem estorno: 12 pedidos na amostra, R$ 1.668,81 cobrados a mais e não devolvidos (`metricas.json`, agora também em `agregados.json`). O estorno é direito comprovado pelo gateway, então o incidente prepara os estornos para o agente de atendimento, sem aviso em massa.
- **Teste ao vivo.** Escolher uma conversa da fila ou escrever uma mensagem fictícia ligada ao pedido dela; o `POST /api/agent` devolve a ficha completa. Se o proxy falhar ou o limite estourar, a tela avisa que o resultado é o gravado.
- **Conferido no navegador** (`npm run dev` e Edge headless): as sete abas abrem sem erro. Na largura de celular (400 px, testada dentro de um iframe, porque o Edge headless não fica abaixo de 496 px), a página não rola na horizontal; só as tabelas e a barra de abas rolam, cada uma no próprio contêiner.
- **Limitação de ambiente.** Neste Windows, `next dev` iniciado pelo Git Bash falha ao criar o processo do loader de CSS (0xc0000142). Iniciado pelo PowerShell/cmd, funciona. O build de produção não é afetado.
