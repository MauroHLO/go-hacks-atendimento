// Limite de requisições em memória, janela fixa (docs/decisoes.md, seção 15).
// Parcial em serverless: cada instância tem o próprio contador e um reinício o zera.
// Sem dependência nem serviço externo. O relógio é injetável para testes.

export interface OpcoesLimitador {
  limite: number; // requisições permitidas por janela
  janelaMs: number;
  deslocamentoMs?: number; // alinha a janela (ex.: dia no fuso de Brasília = -3 h)
  maxChaves?: number; // teto de chaves guardadas, para a memória não crescer sem limite
  agora?: () => number;
}

interface Contagem {
  inicio: number;
  usadas: number;
}

export interface EstadoLimite {
  ok: boolean;
  restante: number;
  reiniciaEm: number; // epoch ms do início da próxima janela
}

export class LimitadorJanela {
  private readonly contagens = new Map<string, Contagem>();
  private readonly limite: number;
  private readonly janelaMs: number;
  private readonly deslocamentoMs: number;
  private readonly maxChaves: number;
  private readonly agora: () => number;

  constructor(o: OpcoesLimitador) {
    if (!Number.isInteger(o.limite) || o.limite < 0) throw new RangeError(`limite inválido: ${o.limite}`);
    if (!Number.isFinite(o.janelaMs) || o.janelaMs <= 0) throw new RangeError(`janela inválida: ${o.janelaMs}`);
    this.limite = o.limite;
    this.janelaMs = o.janelaMs;
    this.deslocamentoMs = o.deslocamentoMs ?? 0;
    this.maxChaves = o.maxChaves ?? 10_000;
    this.agora = o.agora ?? Date.now;
  }

  private inicioJanela(t: number): number {
    return Math.floor((t + this.deslocamentoMs) / this.janelaMs) * this.janelaMs - this.deslocamentoMs;
  }

  private usadasAgora(chave: string, inicio: number): number {
    const c = this.contagens.get(chave);
    return c && c.inicio === inicio ? c.usadas : 0;
  }

  // Consulta sem consumir.
  verificar(chave: string): EstadoLimite {
    const inicio = this.inicioJanela(this.agora());
    const usadas = this.usadasAgora(chave, inicio);
    return { ok: usadas < this.limite, restante: Math.max(0, this.limite - usadas), reiniciaEm: inicio + this.janelaMs };
  }

  // Consome uma unidade se houver; devolve o estado depois do consumo.
  consumir(chave: string): EstadoLimite {
    const inicio = this.inicioJanela(this.agora());
    const usadas = this.usadasAgora(chave, inicio);
    if (usadas >= this.limite) return { ok: false, restante: 0, reiniciaEm: inicio + this.janelaMs };
    this.contagens.delete(chave); // reinsere no fim (ordem de uso recente)
    this.contagens.set(chave, { inicio, usadas: usadas + 1 });
    this.podar(inicio);
    return { ok: true, restante: this.limite - usadas - 1, reiniciaEm: inicio + this.janelaMs };
  }

  get tamanho(): number {
    return this.contagens.size;
  }

  private podar(inicioAtual: number): void {
    if (this.contagens.size <= this.maxChaves) return;
    for (const [chave, c] of this.contagens) {
      if (c.inicio !== inicioAtual) this.contagens.delete(chave);
    }
    // Ainda acima do teto: remove as chaves usadas há mais tempo (início do Map).
    for (const chave of this.contagens.keys()) {
      if (this.contagens.size <= this.maxChaves) break;
      this.contagens.delete(chave);
    }
  }
}

export const MINUTO_MS = 60_000;
export const DIA_MS = 24 * 60 * MINUTO_MS;
export const DESLOCAMENTO_BRASILIA_MS = -3 * 60 * MINUTO_MS; // o dia vira à meia-noite de Brasília

// Verifica todos os limitadores antes de consumir qualquer um: quem é barrado não gasta cota dos outros.
export function consumirTodos(
  itens: readonly { limitador: LimitadorJanela; chave: string; nome: string }[],
): { ok: true } | { ok: false; nome: string; reiniciaEm: number } {
  for (const i of itens) {
    const e = i.limitador.verificar(i.chave);
    if (!e.ok) return { ok: false, nome: i.nome, reiniciaEm: e.reiniciaEm };
  }
  for (const i of itens) i.limitador.consumir(i.chave);
  return { ok: true };
}
