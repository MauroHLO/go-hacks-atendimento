// Revisão manual dos 20 desencontros de maior confiança entre a tag do atendente e o Jev
// (docs/decisoes.md, seção 6). Feita por Mauro, à mão e com apoio de IA, lendo as mensagens e o status
// do pedido. É um julgamento humano registrado, não saída de script; os números derivados vêm de
// data/processed/avaliacao_jev.json.

export interface RevisaoManualJev {
  revisados: number;
  jevCerto: number;
  concordancias: number; // da amostra de 120 (avaliacao_jev.json)
  naoRevisados: number;
  acuraciaMinima: number; // (concordâncias + revisados com o Jev certo) ÷ 120
  observacoes: { conversation_id: string; texto: string }[];
}

export const REVISAO_MANUAL_JEV: RevisaoManualJev = {
  revisados: 20,
  jevCerto: 20,
  concordancias: 71,
  naoRevisados: 29,
  acuraciaMinima: (71 + 20) / 120,
  observacoes: [
    { conversation_id: "AT114627", texto: "dois motivos: atraso/extravio e cancelamento" },
    {
      conversation_id: "AT107397",
      texto: "reação adversa (\"rosto vermelho e ardendo\" depois do sérum) registrada como \"Avaria\" pelo atendente: pela tag, seguiria sem cosmetovigilância",
    },
  ],
};
