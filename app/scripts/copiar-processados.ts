// Copia para app/src/dados/processados/ os arquivos de data/processed que o app usa (rota e interface).
// Uso (em app/): npm run copiar-dados. Rodar depois de simular, processar-fila, avaliar-jev ou casos-demo.
// Só agregados e resultados estruturados: nenhum texto escrito pelo cliente (docs/decisoes.md, seção 7).

import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { OUT, RAIZ } from "./caminhos";

export const ARQUIVOS = ["fila_resultado.json", "casos_demo.json", "simulacao_autonomia.json", "avaliacao_jev.json", "metricas.json"];

const destino = path.join(RAIZ, "app", "src", "dados", "processados");
mkdirSync(destino, { recursive: true });
for (const a of ARQUIVOS) {
  copyFileSync(path.join(OUT, a), path.join(destino, a));
  console.log(`copiado: data/processed/${a} → app/src/dados/processados/${a}`);
}
