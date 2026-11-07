"""
Análise de atendimento (Gocase e GoBeauté) - GoHacks Talent 2026, Desafio 1.

Uso (na raiz do repositório):
    python analysis/analise_atendimento.py

Entrada : data/raw/atendimento/*.csv              (fora do Git)
Saídas  : data/processed/*.csv e metricas.json    (agregados e sinais sem texto livre; vão para o Git)

O histórico é amostra de 1 em cada 4 clientes (parametros.md). Toda métrica de volume, custo
ou horas é reportada com o valor da amostra e o escalado (x4). A fila aberta já está em volume cheio.
Decisões de cálculo: docs/decisoes.md.
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

# --------------------------------------------------------------------------
# Configuração (todos os valores vêm de parametros.md)
# --------------------------------------------------------------------------
BASE = Path(__file__).resolve().parents[1]
RAW = BASE / "data" / "raw" / "atendimento"
OUT = BASE / "data" / "processed"

FATOR_AMOSTRA = 4  # amostra de 1 em cada 4 clientes
CUSTO_CANAL = {"whatsapp": 4.80, "email": 7.20, "reclame_aqui": 42.00}  # R$/conversa
SLA_MIN = {"whatsapp": 30, "email": 24 * 60, "reclame_aqui": 48 * 60}  # primeira resposta
HORARIO = (8, 20)  # humanos atendem das 8h às 20h, todos os dias
AGORA = pd.Timestamp("2026-11-02 08:00:00")  # "agora" do ambiente
INICIO_HIST, FIM_HIST = pd.Timestamp("2026-08-04"), pd.Timestamp("2026-11-01")  # histórico
DIAS_HIST = (FIM_HIST - INICIO_HIST).days + 1  # 90 dias
MESES_HIST = DIAS_HIST / 30  # mês de 30 dias
PRAZO_RECLAMACAO_DIAS = 7  # avaria, faltante e personalização: até 7 dias do recebimento
MIN_CONVERSAS_RECORTE = 30  # recortes com menos conversas não entram no ranking
STATUS_COBRANCA_EFETIVADA = {"capturada", "paga", "estornada"}

# PII: usado só para mascarar o assunto antes de agregar (espelha app/src/lib/pii)
RE_PII = [
    (re.compile(r"\b\d{4}[ \-]?\d{4}[ \-]?\d{4}[ \-]?\d{4}\b"), "[CARTAO]"),
    (re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b"), "[CPF]"),
    (re.compile(r"\(?\d{2}\)?\s?9?\d{4}-?\d{4}"), "[TELEFONE]"),
    (re.compile(r"[\w.\-]+@[\w.\-]+\.\w+"), "[EMAIL]"),
]


def mascarar(texto):
    if not isinstance(texto, str):
        return texto
    for rx, sub in RE_PII:
        texto = rx.sub(sub, texto)
    return texto


# --------------------------------------------------------------------------
# Utilidades
# --------------------------------------------------------------------------
def minutos_uteis(ini, fim, h0=HORARIO[0], h1=HORARIO[1]) -> float:
    """Minutos entre ini e fim contando só a janela h0-h1 de cada dia (todos os dias)."""
    if pd.isna(ini) or pd.isna(fim):
        return np.nan
    total, atual = 0.0, ini
    while atual < fim:
        a = atual.normalize() + pd.Timedelta(hours=h0)
        b = atual.normalize() + pd.Timedelta(hours=h1)
        lo, hi = max(atual, a), min(fim, b)
        if hi > lo:
            total += (hi - lo).total_seconds() / 60
        atual = atual.normalize() + pd.Timedelta(days=1)
    return total


def espera_sla_min(canal, ini, fim) -> float:
    """Espera que conta para o SLA: WhatsApp só em horário comercial; demais, corrida."""
    if pd.isna(ini) or pd.isna(fim):
        return np.nan
    if canal == "whatsapp":
        return minutos_uteis(ini, fim)
    return (fim - ini).total_seconds() / 60


def amostra_e_escalado(valor, casas=1) -> dict:
    return {"amostra": round(float(valor), casas), "escalado_x4": round(float(valor) * FATOR_AMOSTRA, casas)}


def taxa_recontato(df, chave, minimo=0) -> pd.DataFrame:
    """Conversas e % delas em pedidos com mais de uma conversa, por chave."""
    g = df.dropna(subset=chave if isinstance(chave, list) else [chave]).groupby(chave).agg(
        conversas=("recontato", "size"),
        conversas_em_recontato=("recontato", "sum"),
        pedidos=("order_id", "nunique"),
    )
    g["pct_recontato"] = (g.conversas_em_recontato / g.conversas * 100).round(1)
    g = g[g.conversas >= minimo]
    return g.sort_values(["pct_recontato", "conversas"], ascending=False)


def titulo(txt):
    print("\n" + "=" * 78 + f"\n{txt}\n" + "=" * 78)


# --------------------------------------------------------------------------
# Carga
# --------------------------------------------------------------------------
def ler(nome, datas=()):
    return pd.read_csv(RAW / f"{nome}.csv", parse_dates=list(datas))


def carregar() -> dict:
    return {
        "conv": ler("historico_conversas", ["data_abertura", "data_primeira_resposta", "data_encerramento"]),
        "fila": ler("fila_aberta", ["data_abertura", "data_primeira_resposta"]),
        "ped": ler("pedidos", ["data_entrega"]),
        "cli": ler("clientes"),
        "tempo": ler("tempo_por_conversa"),
        "acoes": ler("acoes_executadas_sistemas"),
        "pag": ler("pagamentos_gateway"),
        "est": ler("estornos"),
        "cham": ler("chamados_transportadora"),
        "trocas": ler("trocas_reenvios", ["data_solicitacao"]),
        "anexos": ler("anexos_conversas", ["enviado_em", "exif_data_captura"]),
    }


def validar(d) -> dict:
    conv, ped = d["conv"], d["ped"]
    return {
        "conversas": len(conv),
        "conversas_duplicadas": int(conv.conversation_id.duplicated().sum()),
        "conversas_sem_pedido": int(conv.order_id.isna().sum()),
        "pedidos_nao_encontrados": int((conv.order_id.notna() & ~conv.order_id.isin(ped.order_id)).sum()),
        "conversas_sem_tempo_por_conversa": int((~conv.conversation_id.isin(d["tempo"].conversation_id)).sum()),
        "periodo": [str(conv.data_abertura.min()), str(conv.data_abertura.max())],
    }


# --------------------------------------------------------------------------
# 1. Volume e custo
# --------------------------------------------------------------------------
def volume_custo(conv, tempo) -> tuple:
    conv = conv.copy()
    conv["tag"] = conv.tag_agente.fillna("(sem tag: só bot)")
    conv["custo_rs"] = conv.canal.map(CUSTO_CANAL)

    por_canal = conv.groupby("canal").agg(conversas=("custo_rs", "size"), custo_rs=("custo_rs", "sum"))
    por_canal["conversas_x4"] = por_canal.conversas * FATOR_AMOSTRA
    por_canal["custo_rs_x4"] = por_canal.custo_rs * FATOR_AMOSTRA
    por_canal["pct_conversas"] = por_canal.conversas / len(conv) * 100
    por_canal["pct_custo"] = por_canal.custo_rs / por_canal.custo_rs.sum() * 100

    por_tag = conv.groupby("tag").agg(conversas=("custo_rs", "size"), custo_rs=("custo_rs", "sum"))
    por_tag["conversas_x4"] = por_tag.conversas * FATOR_AMOSTRA
    por_tag["custo_rs_x4"] = por_tag.custo_rs * FATOR_AMOSTRA
    por_tag["pct_conversas"] = por_tag.conversas / len(conv) * 100
    por_tag = por_tag.sort_values("conversas", ascending=False)

    t = tempo.drop(columns=["canal"]).merge(conv[["conversation_id", "canal", "tag"]], on="conversation_id")
    tempo_tag_canal = t.groupby(["tag", "canal"]).agg(
        conversas=("minutos_trabalhados", "size"),
        minutos_trabalhados_medio=("minutos_trabalhados", "mean"),
        sistemas_acessados_medio=("sistemas_acessados", "mean"),
        minutos_trabalhados_total=("minutos_trabalhados", "sum"),
    )
    tempo_tag = t.groupby("tag").agg(
        conversas=("minutos_trabalhados", "size"),
        minutos_trabalhados_medio=("minutos_trabalhados", "mean"),
        sistemas_acessados_medio=("sistemas_acessados", "mean"),
        minutos_trabalhados_total=("minutos_trabalhados", "sum"),
    ).sort_values("minutos_trabalhados_total", ascending=False)

    horas = t.minutos_trabalhados.sum() / 60
    fora = (conv.data_abertura.dt.hour < HORARIO[0]) | (conv.data_abertura.dt.hour >= HORARIO[1])
    custo = conv.custo_rs.sum()
    m = {
        "conversas": {"amostra": len(conv), "escalado_x4": len(conv) * FATOR_AMOSTRA},
        "conversas_por_mes": amostra_e_escalado(len(conv) / MESES_HIST, 0),
        "custo_periodo_rs": amostra_e_escalado(custo, 2),
        "custo_por_mes_rs": amostra_e_escalado(custo / MESES_HIST, 2),
        "horas_trabalhadas_periodo": amostra_e_escalado(horas),
        "horas_trabalhadas_por_mes": amostra_e_escalado(horas / MESES_HIST),
        "minutos_trabalhados_medio": round(float(t.minutos_trabalhados.mean()), 1),
        "conversas_sem_tag_so_bot": int(conv.tag_agente.isna().sum()),
        "pct_aberto_fora_8h_20h": round(float(fora.mean() * 100), 1),
        "pct_aberto_fora_8h_20h_por_canal": (conv[fora].canal.value_counts() / conv.canal.value_counts() * 100)
        .round(1).to_dict(),
        "dias_historico": DIAS_HIST,
        "meses_historico": round(MESES_HIST, 2),
    }
    return m, por_canal.round(2), por_tag.round(2), tempo_tag_canal.round(2), tempo_tag.round(2)


# --------------------------------------------------------------------------
# 2. SLA de primeira resposta
# --------------------------------------------------------------------------
def sla(conv) -> pd.DataFrame:
    d = conv.dropna(subset=["data_primeira_resposta"]).copy()
    d["espera_min"] = [espera_sla_min(c, a, b) for c, a, b in
                       zip(d.canal, d.data_abertura, d.data_primeira_resposta)]
    d["estourou"] = d.espera_min > d.canal.map(SLA_MIN)
    g = d.groupby("canal").agg(
        conversas_com_resposta_humana=("estourou", "size"),
        espera_mediana_min=("espera_min", "median"),
        espera_p90_min=("espera_min", lambda s: s.quantile(0.9)),
        estouros=("estourou", "sum"),
        pct_estouro_sla=("estourou", lambda s: s.mean() * 100),
    )
    g["sla_min"] = g.index.map(SLA_MIN)
    g["sem_resposta_humana"] = conv[conv.data_primeira_resposta.isna()].canal.value_counts().reindex(g.index).fillna(0).astype(int)
    return g.round(1)


# --------------------------------------------------------------------------
# 3. Trabalho espalhado
# --------------------------------------------------------------------------
def trabalho_espalhado(tempo, acoes) -> tuple:
    por_sistema = acoes.groupby("sistema").agg(
        acoes=("acao_id", "size"), conversas=("conversation_id", "nunique"))
    por_sistema["pct_acoes"] = por_sistema.acoes / len(acoes) * 100
    por_sistema = por_sistema.sort_values("acoes", ascending=False).round(1)
    sistema_acao = acoes.groupby(["sistema", "acao"]).size().rename("acoes").reset_index() \
        .sort_values(["sistema", "acoes"], ascending=[True, False])
    sist_conv = acoes.groupby("conversation_id").sistema.nunique()
    m = {
        "sistemas_acessados_medio": round(float(tempo.sistemas_acessados.mean()), 2),
        "sistemas_acessados_medio_por_canal": tempo.groupby("canal").sistemas_acessados.mean().round(2).to_dict(),
        "pct_conversas_com_3_ou_mais_sistemas": round(float((tempo.sistemas_acessados >= 3).mean() * 100), 1),
        "acoes_registradas": int(len(acoes)),
        "sistemas_distintos_com_acao_medio": round(float(sist_conv.mean()), 2),
    }
    return m, por_sistema, sistema_acao


# --------------------------------------------------------------------------
# 4. Recontato e causa-raiz
# --------------------------------------------------------------------------
def recontato(conv, ped, cham, pag, est) -> tuple:
    cols = ["order_id", "transportadora", "uf", "maquina_personalizacao", "lote_produto",
            "cd_separacao", "descricao_produto", "marca"]
    df = conv.drop(columns=["marca"]).merge(ped[cols], on="order_id", how="left")
    n = df.groupby("order_id").conversation_id.transform("size")  # NaN para conversas sem pedido
    df["recontato"] = n > 1

    pedidos_rec = int((df.groupby("order_id").size() > 1).sum())
    conv_rec = int(df.recontato.sum())
    com_pedido = df.order_id.notna()

    tabelas = {
        "recontato_transportadora": taxa_recontato(df, "transportadora"),
        "recontato_transportadora_uf": taxa_recontato(df, ["transportadora", "uf"], MIN_CONVERSAS_RECORTE),
        "recontato_maquina": taxa_recontato(df, "maquina_personalizacao"),
        "recontato_lote": taxa_recontato(df, "lote_produto"),
        "recontato_cd": taxa_recontato(df, "cd_separacao"),
    }
    t = tabelas["recontato_transportadora"]
    demais = t.drop(index="Expressa Já", errors="ignore")

    # Chamados com as transportadoras
    ch = cham.groupby("transportadora").agg(
        chamados=("chamado_id", "size"), pedidos=("order_id", "nunique"))
    ch_motivo = cham.groupby(["transportadora", "motivo"]).size().rename("chamados").reset_index()

    # Campanha com brinde
    brinde = df[df.descricao_produto.str.contains(r"\+ Brinde", na=False, regex=True)].copy()
    brinde["tag"] = brinde.tag_agente.fillna("(sem tag: só bot)")
    brinde_tags = brinde.groupby("tag").agg(conversas=("conversation_id", "size"),
                                            pedidos=("order_id", "nunique")).sort_values("conversas", ascending=False)
    pedidos_brinde_total = int(ped.descricao_produto.str.contains(r"\+ Brinde", na=False, regex=True).sum())

    # Cobrança duplicada: mais de uma cobrança efetivada no mesmo pedido
    ef = pag[pag.status.isin(STATUS_COBRANCA_EFETIVADA)]
    n_ef = ef.groupby("order_id").size()
    dup = n_ef[n_ef > 1].index
    pag_dup = pag[pag.order_id.isin(dup)]
    estornado_gateway = set(pag_dup.loc[(pag_dup.status == "estornada") | (pag_dup.valor_estornado > 0), "order_id"])
    estornado_registro = set(est.loc[est.order_id.isin(dup) & (est.status == "concluido"), "order_id"])
    em_processo = set(est.loc[est.order_id.isin(dup) & (est.status == "em_processamento"), "order_id"]) - estornado_gateway
    com_estorno = estornado_gateway | estornado_registro
    sem_estorno = set(dup) - com_estorno
    conv_dup = df[df.order_id.isin(dup)]
    valor_sem_estorno = (ef[ef.order_id.isin(sem_estorno)].groupby("order_id").valor
                         .apply(lambda s: s.sort_values().iloc[:-1].sum()).sum())  # excedente = todas menos uma
    cobranca = pd.DataFrame({
        "situacao": ["com_estorno", "sem_estorno", "sem_estorno_com_estorno_em_processamento"],
        "pedidos": [len(com_estorno), len(sem_estorno), len(em_processo & sem_estorno)],
        "conversas": [int(conv_dup.order_id.isin(com_estorno).sum()), int(conv_dup.order_id.isin(sem_estorno).sum()),
                      int(conv_dup.order_id.isin(em_processo & sem_estorno).sum())],
    })

    m = {
        "pedidos_com_recontato": pedidos_rec,
        "conversas_em_pedidos_com_recontato": conv_rec,
        "pct_conversas_com_pedido_em_recontato": round(conv_rec / int(com_pedido.sum()) * 100, 1),
        "conversas_em_pedidos_com_recontato_x4": conv_rec * FATOR_AMOSTRA,
        "expressa_ja": {
            "conversas": int(t.loc["Expressa Já", "conversas"]),
            "pct_recontato": float(t.loc["Expressa Já", "pct_recontato"]),
            "pct_recontato_demais": round(float(demais.conversas_em_recontato.sum() / demais.conversas.sum() * 100), 1),
            "ufs_top": tabelas["recontato_transportadora_uf"].loc["Expressa Já"]
            .sort_values("conversas", ascending=False).head(3).index.tolist(),
        },
        "chamados_transportadora": {"total": int(len(cham)), "por_transportadora": ch.chamados.to_dict()},
        "brinde": {
            "pedidos_com_brinde_na_base": pedidos_brinde_total,
            "pedidos_com_brinde_e_conversa": int(brinde.order_id.nunique()),
            "conversas": int(len(brinde)),
            "conversas_produto_faltando": int((brinde.tag_agente == "Produto faltando").sum()),
        },
        "cobranca_duplicada": {
            "pedidos": int(len(dup)),
            "com_estorno": len(com_estorno),
            "sem_estorno": len(sem_estorno),
            "sem_estorno_com_estorno_em_processamento": len(em_processo & sem_estorno),
            "valor_excedente_sem_estorno_rs": round(float(valor_sem_estorno), 2),
            "conversas_nesses_pedidos": int(len(conv_dup)),
        },
    }
    extras = {"chamados_transportadora": ch, "chamados_transportadora_motivo": ch_motivo,
              "brinde_tags": brinde_tags, "cobranca_duplicada": cobranca}
    return m, tabelas, extras


# --------------------------------------------------------------------------
# 5. Evidências (anexos)
# --------------------------------------------------------------------------
def evidencias(anexos, ped, trocas, cli) -> tuple:
    a = anexos.merge(ped[["order_id", "data_entrega"]], on="order_id", how="left")
    a = a.merge(cli[["customer_id", "n_trocas_12m"]], on="customer_id", how="left")

    # hash_perceptual repetido: em quais escopos a mesma imagem aparece em outro anexo
    por_hash = a.groupby("hash_perceptual").agg(
        n_anexos=("anexo_id", "size"), n_pedidos=("order_id", "nunique"), n_clientes=("customer_id", "nunique"))
    a = a.join(por_hash, on="hash_perceptual")
    n_mesmo_pedido = a.groupby(["hash_perceptual", "order_id"]).anexo_id.transform("size")
    a["hash_repetido"] = a.n_anexos > 1
    a["hash_mesmo_pedido"] = n_mesmo_pedido > 1
    a["hash_outro_pedido"] = a.n_pedidos > 1
    a["hash_outro_cliente"] = a.n_clientes > 1

    # metadados
    a["exif_antes_entrega"] = a.exif_data_captura.notna() & a.data_entrega.notna() & \
        (a.exif_data_captura < a.data_entrega)
    a["exif_software_edicao"] = a.exif_software.notna()
    a["dias_apos_entrega"] = (a.enviado_em.dt.normalize() - a.data_entrega).dt.days
    a["fora_prazo_7d"] = a.dias_apos_entrega > PRAZO_RECLAMACAO_DIAS

    # reenvios/trocas anteriores do cliente (OMS), em qualquer pedido, antes do envio da foto
    tr = trocas[["customer_id", "data_solicitacao"]].merge(a[["anexo_id", "customer_id", "enviado_em"]], on="customer_id")
    anteriores = tr[tr.data_solicitacao < tr.enviado_em].groupby("anexo_id").size()
    a["reenvios_anteriores_oms"] = a.anexo_id.map(anteriores).fillna(0).astype(int)
    a["n_trocas_12m"] = a.n_trocas_12m.fillna(0).astype(int)

    sinais = ["hash_repetido", "exif_antes_entrega", "exif_software_edicao", "fora_prazo_7d"]
    a["n_sinais"] = a[sinais].sum(axis=1) + (a.reenvios_anteriores_oms > 0)

    colunas = ["anexo_id", "conversation_id", "order_id", "customer_id", "canal", "enviado_em", "tipo",
               "hash_perceptual", "n_anexos", "hash_repetido", "hash_mesmo_pedido", "hash_outro_pedido",
               "hash_outro_cliente", "exif_antes_entrega", "exif_software_edicao", "dias_apos_entrega",
               "fora_prazo_7d", "reenvios_anteriores_oms", "n_trocas_12m", "n_sinais"]
    tabela = a[colunas].rename(columns={"n_anexos": "anexos_com_mesmo_hash"})  # sem descricao_visual nem EXIF bruto

    rep = por_hash[por_hash.n_anexos > 1]
    m = {
        "anexos": int(len(a)),
        "hashes_repetidos": int(len(rep)),
        "anexos_com_hash_repetido": int(rep.n_anexos.sum()),
        "anexos_hash_mesmo_pedido": int(a.hash_mesmo_pedido.sum()),
        "anexos_hash_outro_pedido": int(a.hash_outro_pedido.sum()),
        "anexos_hash_outro_cliente": int(a.hash_outro_cliente.sum()),
        "hashes_em_mais_de_um_cliente": int((rep.n_clientes > 1).sum()),
        "anexos_com_exif_data": int(a.exif_data_captura.notna().sum()),
        "exif_antes_entrega": int(a.exif_antes_entrega.sum()),
        "exif_software_edicao": int(a.exif_software_edicao.sum()),
        "exif_software_valores": a.exif_software.value_counts().to_dict(),
        "fora_prazo_7d": int(a.fora_prazo_7d.sum()),
        "anexos_de_clientes_com_reenvio_anterior": int((a.reenvios_anteriores_oms > 0).sum()),
        "anexos_por_n_sinais": a.n_sinais.value_counts().sort_index().to_dict(),
    }
    return m, tabela


# --------------------------------------------------------------------------
# 6. Fila de agora
# --------------------------------------------------------------------------
def fila_agora(fila) -> tuple:
    f = fila.copy()
    f["idade_h"] = ((AGORA - f.data_abertura).dt.total_seconds() / 3600).round(1)
    # espera de primeira resposta: até a resposta, se houve; senão até agora
    fim = f.data_primeira_resposta.fillna(AGORA)
    f["espera_sla_min"] = [espera_sla_min(c, a, b) for c, a, b in zip(f.canal, f.data_abertura, fim)]
    f["sla_min"] = f.canal.map(SLA_MIN)
    f["sla_estourado"] = f.espera_sla_min > f.sla_min
    # só faz sentido para quem ainda não teve primeira resposta
    f["sla_restante_min"] = np.where(f.data_primeira_resposta.isna(), f.sla_min - f.espera_sla_min, np.nan)
    f["assunto"] = f.assunto.map(mascarar).fillna("(vazio)")

    resumo = f.groupby(["canal", "status"]).agg(
        conversas=("conversation_id", "size"),
        idade_media_h=("idade_h", "mean"),
        idade_max_h=("idade_h", "max"),
        sla_estourado=("sla_estourado", "sum"),
    ).round(1)
    assunto = f.groupby(["canal", "assunto"]).size().rename("conversas").reset_index() \
        .sort_values(["canal", "conversas"], ascending=[True, False])
    por_conversa = f[["conversation_id", "order_id", "marca", "canal", "status", "data_abertura",
                      "data_primeira_resposta", "idade_h", "espera_sla_min", "sla_min", "sla_estourado", "sla_restante_min"]] \
        .sort_values("idade_h", ascending=False)
    por_conversa["espera_sla_min"] = por_conversa.espera_sla_min.round(0)
    m = {
        "conversas": int(len(f)),
        "por_canal": f.canal.value_counts().to_dict(),
        "por_status": f.status.value_counts().to_dict(),
        "sla_estourado": int(f.sla_estourado.sum()),
        "sla_estourado_por_canal": f.groupby("canal").sla_estourado.sum().astype(int).to_dict(),
        "sem_resposta_estoura_em_ate_30min": int((f.sla_restante_min.between(0, 30)).sum()),
        "idade_mediana_h": float(f.idade_h.median()),
        "observacao": "fila em volume cheio (não escalar)",
    }
    return m, resumo, assunto, por_conversa


# --------------------------------------------------------------------------
# Execução
# --------------------------------------------------------------------------
def gravar(df, nome, index=True):
    df.to_csv(OUT / f"{nome}.csv", index=index)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)
    pd.set_option("display.width", 200)
    pd.set_option("display.max_columns", 30)
    pd.set_option("display.max_rows", 60)

    d = carregar()
    met = {"fator_amostra": FATOR_AMOSTRA, "agora": str(AGORA)}

    titulo("0. Validação")
    met["validacao"] = validar(d)
    print(json.dumps(met["validacao"], indent=2, ensure_ascii=False))

    titulo("1. Volume e custo (amostra e escalado x4)")
    m, por_canal, por_tag, tempo_tc, tempo_t = volume_custo(d["conv"], d["tempo"])
    met["volume_custo"] = m
    print(por_canal, "\n")
    print(por_tag, "\n")
    print("Tempo por tag:\n", tempo_t, "\n")
    print(json.dumps(m, indent=2, ensure_ascii=False))
    gravar(por_canal, "volume_canal")
    gravar(por_tag, "volume_tag")
    gravar(tempo_tc, "tempo_tag_canal")
    gravar(tempo_t, "tempo_tag")

    titulo("2. SLA de primeira resposta (WhatsApp: só 8h-20h)")
    s = sla(d["conv"])
    print(s)
    gravar(s, "sla_canal")
    met["sla"] = s[["pct_estouro_sla", "espera_mediana_min", "estouros"]].to_dict(orient="index")

    titulo("3. Trabalho espalhado entre sistemas")
    m, por_sistema, sistema_acao = trabalho_espalhado(d["tempo"], d["acoes"])
    met["trabalho_espalhado"] = m
    print(por_sistema, "\n")
    print(json.dumps(m, indent=2, ensure_ascii=False))
    gravar(por_sistema, "acoes_por_sistema")
    gravar(sistema_acao, "acoes_por_sistema_acao", index=False)

    titulo("4. Recontato e causa-raiz")
    m, tabs, extras = recontato(d["conv"], d["ped"], d["cham"], d["pag"], d["est"])
    met["recontato"] = m
    for nome, t in tabs.items():
        gravar(t, nome)
    for nome, t in extras.items():
        gravar(t, nome, index=nome not in {"chamados_transportadora_motivo", "cobranca_duplicada"})
    print("Por transportadora:\n", tabs["recontato_transportadora"], "\n")
    print(f"Transportadora x UF (>= {MIN_CONVERSAS_RECORTE} conversas):\n", tabs["recontato_transportadora_uf"].head(12), "\n")
    print("Por máquina:\n", tabs["recontato_maquina"], "\n")
    print("Por CD:\n", tabs["recontato_cd"], "\n")
    print("Por lote (10 maiores taxas com >= 5 conversas):\n",
          tabs["recontato_lote"][tabs["recontato_lote"].conversas >= 5].head(10), "\n")
    print("Tags nos pedidos com brinde:\n", extras["brinde_tags"], "\n")
    print("Cobrança duplicada:\n", extras["cobranca_duplicada"], "\n")
    print(json.dumps(m, indent=2, ensure_ascii=False))

    titulo("5. Evidências nos anexos")
    m, anexos = evidencias(d["anexos"], d["ped"], d["trocas"], d["cli"])
    met["evidencias"] = m
    gravar(anexos, "anexos_sinais", index=False)
    print(json.dumps(m, indent=2, ensure_ascii=False))

    titulo("6. Fila de agora (02/11 08:00, volume cheio)")
    m, resumo, assunto, por_conversa = fila_agora(d["fila"])
    met["fila"] = m
    gravar(resumo, "fila_resumo")
    gravar(assunto, "fila_assunto", index=False)
    gravar(por_conversa, "fila_conversas", index=False)
    print(resumo, "\n")
    print(json.dumps(m, indent=2, ensure_ascii=False))

    with open(OUT / "metricas.json", "w", encoding="utf-8") as f:
        json.dump(met, f, indent=2, ensure_ascii=False, default=lambda o: o.item() if hasattr(o, "item") else str(o))
    print(f"\nArquivos gravados em {OUT}")


if __name__ == "__main__":
    main()
