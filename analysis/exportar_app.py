"""
Exporta para o app só o necessário para atender as 65 conversas da fila aberta (02/11/2026 08:00).

Uso (na raiz do repositório):
    python analysis/exportar_app.py

Entrada : data/raw/atendimento/*.csv   (fora do Git)
Saída   : app/src/dados/*.json         (vai para o Git e para a Vercel)

Os dados são sintéticos e fornecidos pela organização. As mensagens da fila entram com CPF, telefone,
e-mail e cartão mascarados pelas mesmas regras de app/src/lib/pii (exceção registrada em docs/decisoes.md,
seção 3). O cliente vai sem nome, CPF, telefone, e-mail e endereço; o pedido vai sem CEP e cidade.
"""
import json
import re
import sys
from pathlib import Path

import pandas as pd

BASE = Path(__file__).resolve().parents[1]
RAW = BASE / "data" / "raw" / "atendimento"
OUT = BASE / "app" / "src" / "dados"

# Mesmas expressões e mesma ordem de app/src/lib/pii/index.ts. O \w do Python já cobre letras
# acentuadas, como as classes \p{L}\p{N} do JavaScript.
RE_CARTAO = re.compile(r"\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}\b")
RE_CPF = re.compile(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b")
RE_TELEFONE = re.compile(r"\(\d{2}\)\s?\d{4,5}-\d{4}")
RE_EMAIL = re.compile(r"[\w.-]+@[\w.-]+\.\w+")
# Conferência extra (não mascara): sequências que parecem documento ou telefone sem formatação.
RE_SUSPEITO = re.compile(r"\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}|\d{2}\s?9?\d{4}-?\d{4}")


def mascarar_pii(texto):
    if not isinstance(texto, str):
        return texto
    texto = RE_CARTAO.sub("[CARTAO]", texto)
    texto = RE_CPF.sub("[CPF]", texto)
    texto = RE_TELEFONE.sub("[TELEFONE]", texto)
    return RE_EMAIL.sub("[EMAIL]", texto)


def ler(nome):
    return pd.read_csv(RAW / f"{nome}.csv", dtype=str, keep_default_na=False)


def registros(df: pd.DataFrame, numericas=()) -> list:
    """DataFrame -> lista de dicts; vazio vira null; colunas numéricas viram número."""
    out = []
    for r in df.to_dict(orient="records"):
        linha = {}
        for k, v in r.items():
            if v == "":
                linha[k] = None
            elif k in numericas:
                f = float(v)
                linha[k] = int(f) if f.is_integer() and k.startswith(("n_", "quantidade", "parcelas", "linha")) else f
            else:
                linha[k] = v
        out.append(linha)
    return out


def gravar(nome, dados):
    caminho = OUT / f"{nome}.json"
    with open(caminho, "w", encoding="utf-8", newline="\n") as f:
        json.dump(dados, f, ensure_ascii=False, indent=1)
        f.write("\n")
    n = len(dados) if isinstance(dados, (list, dict)) else 1
    print(f"  {caminho.relative_to(BASE)}: {n} registros")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)

    fila = ler("fila_aberta")
    pedidos_ids = set(fila.order_id) - {""}
    clientes_ids = set(fila.customer_id) - {""}
    conversas_ids = set(fila.conversation_id)
    print(f"Fila: {len(fila)} conversas, {len(pedidos_ids)} pedidos, {len(clientes_ids)} clientes")

    # Conversas: canal, status, abertura e assunto mascarado
    conv = fila[["conversation_id", "customer_id", "order_id", "marca", "canal", "status", "data_abertura",
                 "n_interacoes", "atendente_id", "data_primeira_resposta", "assunto"]].copy()
    conv["assunto"] = conv.assunto.map(mascarar_pii)
    gravar("conversas", registros(conv, numericas={"n_interacoes"}))

    # Mensagens da fila, mascaradas
    msg = ler("historico_mensagens")
    msg = msg[msg.conversation_id.isin(conversas_ids)].copy()
    antes = msg.texto.copy()
    msg["texto"] = msg.texto.map(mascarar_pii)
    trocados = int((antes != msg.texto).sum())
    restantes = msg.texto.str.contains(RE_SUSPEITO)
    print(f"  mensagens: {len(msg)}; {trocados} com dado pessoal mascarado; {int(restantes.sum())} ainda com sequência suspeita")
    if restantes.any():
        for t in msg.loc[restantes, "texto"]:
            print("    conferir:", RE_SUSPEITO.findall(t))
    gravar("mensagens", registros(msg))

    # Pedido (sem CEP e cidade de entrega), itens, rastreio, pagamentos, estornos, chamados
    ped = ler("pedidos")
    ped = ped[ped.order_id.isin(pedidos_ids)].drop(columns=["cep_entrega", "cidade_entrega"])
    gravar("pedidos", registros(ped, numericas={"valor", "valor_produtos", "desconto", "frete_cobrado",
                                                "quantidade_itens", "parcelas"}))
    itens = ler("itens_pedido")
    gravar("itens", registros(itens[itens.order_id.isin(pedidos_ids)],
                              numericas={"linha", "quantidade", "preco_unitario", "desconto_rateado", "valor_total"}))
    rast = ler("rastreio_portais_transportadoras")
    gravar("rastreio", registros(rast[rast.pedido_ref.isin(pedidos_ids)]))
    pag = ler("pagamentos_gateway")
    pag = pag[pag.order_id.isin(pedidos_ids)].drop(columns=["end_to_end_pix"])  # identificador de transação Pix
    gravar("pagamentos", registros(pag, numericas={"valor", "valor_estornado", "parcelas"}))
    est = ler("estornos")
    gravar("estornos", registros(est[est.order_id.isin(pedidos_ids)], numericas={"valor"}))
    cham = ler("chamados_transportadora")
    gravar("chamados", registros(cham[cham.order_id.isin(pedidos_ids)]))

    # Trocas e reenvios do cliente (todos os pedidos dele)
    tr = ler("trocas_reenvios")
    gravar("trocas_reenvios", registros(tr[tr.customer_id.isin(clientes_ids)].drop(columns=["texto_personalizacao"]),
                                        numericas={"quantidade", "custo_produto", "custo_frete", "custo_manuseio", "custo_total"}))

    # Cliente sem dados pessoais
    cli = ler("clientes")
    cli = cli[cli.customer_id.isin(clientes_ids)][
        ["customer_id", "segmento", "n_pedidos", "receita_acumulada", "n_trocas_12m",
         "aceita_comunicacao_whatsapp", "aceita_comunicacao_email"]]
    gravar("clientes", registros(cli, numericas={"n_pedidos", "receita_acumulada", "n_trocas_12m"}))

    # Anexos: os de pedidos ou clientes da fila (a fila em si não tem anexos; os novos chegam por ver_anexos)
    anx = ler("anexos_conversas")
    rel = anx[anx.order_id.isin(pedidos_ids) | anx.customer_id.isin(clientes_ids) | anx.conversation_id.isin(conversas_ids)]
    gravar("anexos", registros(rel))
    # Índice hash_perceptual -> pedidos e clientes, sobre TODOS os anexos
    indice = {}
    for h, g in anx.groupby("hash_perceptual"):
        indice[h] = [{"anexo_id": a, "order_id": o or None, "customer_id": c}
                     for a, o, c in zip(g.anexo_id, g.order_id, g.customer_id)]
    gravar("indice_hash", indice)

    # Catálogo (ficha do produto para responder_duvida e comparação com a foto), cupons e uso de cupons
    gravar("produtos", registros(ler("produtos"), numericas={"preco_venda", "custo_unitario"}))
    gravar("cupons", registros(ler("cupons")))
    uso = ler("uso_cupons")
    gravar("uso_cupons", registros(uso[uso.customer_id.isin(clientes_ids)], numericas={"valor_produtos", "valor_desconto"}))

    # Regras e catálogo de ferramentas
    gravar("politicas", registros(ler("politicas")))
    ferr = ler("ferramentas")
    ferramentas = []
    for r in ferr.to_dict(orient="records"):
        ferramentas.append({
            "ferramenta": r["ferramenta"],
            "papeis_permitidos": [p.strip() for p in r["papeis_permitidos"].split(";") if p.strip()],
            "descricao": r["descricao"],
            "parametros": [p.strip() for p in r["parametros"].split(";") if p.strip()],
            "limites": json.loads(r["limites"] or "{}"),
        })
    gravar("ferramentas", ferramentas)

    # Agente analista (docs/decisoes.md, seção 6): agregados de causa-raiz e pedidos ainda em aberto afetados.
    exportar_analista()


UFS_NE = ["BA", "PE", "CE", "RN", "PB", "MA", "PI", "AL", "SE"]  # politicas.csv › prazos_entrega › regiao_por_uf
CORTE = "2026-11-02"


def exportar_analista():
    proc = BASE / "data" / "processed"
    with open(proc / "metricas.json", encoding="utf-8") as f:
        met = json.load(f)["recontato"]
    tuf = pd.read_csv(proc / "recontato_transportadora_uf.csv")
    tr = pd.read_csv(proc / "recontato_transportadora.csv")
    gravar("agregados", {
        "fonte": "data/processed (analysis/analise_atendimento.py); amostra de 1 em 4 clientes",
        "recontato_transportadora": tr.to_dict(orient="records"),
        "recontato_transportadora_uf": tuf.to_dict(orient="records"),
        "pct_recontato_demais_transportadoras": met["expressa_ja"]["pct_recontato_demais"],
        "brinde": met["brinde"],
    })

    # Pedidos abertos (sem entrega) em 02/11 que um aviso proativo pode alcançar: Expressa Já no Nordeste e
    # pedidos da campanha com brinde. Só identificadores, situação e consentimentos (sem dado pessoal).
    ped = ler("pedidos")
    ped = ped[(ped.data_pedido < CORTE) & ped.status_entrega.isin(["aguardando_separacao", "em_transito"])]
    ped = ped.assign(tem_brinde=ped.descricao_produto.str.contains(r"\+ Brinde", regex=True))
    alvo = ped[((ped.transportadora == "Expressa Já") & ped.uf.isin(UFS_NE)) | ped.tem_brinde]
    cli = ler("clientes")[["customer_id", "aceita_comunicacao_whatsapp", "aceita_comunicacao_email"]]
    alvo = alvo.merge(cli, on="customer_id", how="left")
    cols = ["order_id", "customer_id", "transportadora", "uf", "status_entrega", "data_prometida", "tem_brinde",
            "aceita_comunicacao_whatsapp", "aceita_comunicacao_email"]
    reg = registros(alvo[cols].assign(tem_brinde=alvo.tem_brinde.map(lambda b: "sim" if b else "nao")))
    for r in reg:
        r["tem_brinde"] = r["tem_brinde"] == "sim"
    gravar("pedidos_afetados", reg)


if __name__ == "__main__":
    main()
