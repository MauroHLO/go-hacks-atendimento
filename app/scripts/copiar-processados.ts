// Copia para app/src/dados/processados/ os arquivos de data/processed que o app usa (rota e interface).
// Uso (em app/): npm run copiar-dados. Rodar depois de simular, processar-fila, avaliar-jev, casos-demo ou
// anexos-conferidos. Só agregados e resultados estruturados: nenhum texto escrito pelo cliente.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { OUT, RAIZ } from "./caminhos";

export const ARQUIVOS = [
  "fila_resultado.json",
  "casos_demo.json",
  "simulacao_autonomia.json",
  "avaliacao_jev.json",
  "metricas.json",
  "anexos_conferidos.json",
];
// CSV simples (sem aspas nem vírgulas nos campos) convertidos para JSON.
const CSV = ["fila_conversas", "volume_canal", "sla_canal"];

const destino = path.join(RAIZ, "app", "src", "dados", "processados");
mkdirSync(destino, { recursive: true });
for (const a of ARQUIVOS) {
  copyFileSync(path.join(OUT, a), path.join(destino, a));
  console.log(`copiado: data/processed/${a} → app/src/dados/processados/${a}`);
}
for (const nome of CSV) {
  const [cab, ...linhas] = readFileSync(path.join(OUT, `${nome}.csv`), "utf8").replace(/^﻿/, "").trim().split(/\r?\n/);
  const campos = cab.split(",");
  const valor = (v: string) => (v === "" ? null : v === "True" ? true : v === "False" ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);
  const json = linhas.map((l) => Object.fromEntries(l.split(",").map((v, i) => [campos[i], valor(v)])));
  writeFileSync(path.join(destino, `${nome}.json`), JSON.stringify(json, null, 2) + "\n");
  console.log(`convertido: data/processed/${nome}.csv → app/src/dados/processados/${nome}.json`);
}
