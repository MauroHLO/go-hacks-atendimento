// Caminhos da raiz do repositório para os scripts (rodam em app/ ou na raiz).
import { existsSync } from "node:fs";
import path from "node:path";

export const RAIZ = existsSync(path.resolve("..", "data")) ? path.resolve("..") : path.resolve(".");
export const OUT = path.join(RAIZ, "data", "processed");
