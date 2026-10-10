import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  BorderStyle,
} from 'docx';
import { frenchTypography } from './typography';

export type FicheQuestion = { question: string; reponse: string; renvoi: string; origine: string };

const ORIGINE_FR: Record<string, string> = {
  remarque_jury: 'Remarque du jury simulé',
  faiblesse: 'Faiblesse connue',
  methode: 'Méthodologie',
  resultats: 'Résultats',
  theorie: 'Cadre théorique',
  general: 'Général',
};

/** Fiche de préparation à la soutenance (CdC §9 P9, §17.7) : questions probables, éléments de réponse, renvois aux sections. */
export async function buildFiche(
  title: string,
  questions: FicheQuestion[],
  weaknesses: string[],
): Promise<Buffer> {
  const b = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
  const borders = { top: b, bottom: b, left: b, right: b };
  const cell = (t: string, o: { bold?: boolean; fill?: string; w: number }) =>
    new TableCell({
      borders,
      width: { size: o.w, type: WidthType.PERCENTAGE },
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
      ...(o.fill ? { shading: { type: ShadingType.CLEAR, fill: o.fill, color: 'auto' } } : {}),
      children: t.split('\n').map(
        (l) =>
          new Paragraph({
            children: [new TextRun({ text: frenchTypography(l), bold: o.bold, size: 20 })],
          }),
      ),
    });
  const doc = new Document({
    creator: 'emilio agent',
    title: `Fiche de préparation — ${title}`,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: 'Fiche de préparation à la soutenance', bold: true, size: 36 }),
            ],
            spacing: { after: 120 },
          }),
          new Paragraph({
            children: [new TextRun({ text: frenchTypography(title), italics: true, size: 26 })],
            spacing: { after: 240 },
          }),
          new Paragraph({
            spacing: { after: 240 },
            children: [
              new TextRun({
                text: 'Ces questions et ces éléments de réponse ont été préparés automatiquement à partir de votre travail et des remarques du jury simulé. Ils vous aident à maîtriser votre contenu : relisez-les, corrigez-les et appropriez-vous les réponses. Vous restez l’auteur responsable de votre travail.',
                size: 22,
              }),
            ],
          }),
          ...(weaknesses.length
            ? [
                new Paragraph({
                  children: [
                    new TextRun({ text: 'Points faibles à anticiper', bold: true, size: 26 }),
                  ],
                  spacing: { before: 120, after: 80 },
                }),
                ...weaknesses.map(
                  (w) =>
                    new Paragraph({
                      bullet: { level: 0 },
                      children: [new TextRun({ text: frenchTypography(w), size: 22 })],
                    }),
                ),
              ]
            : []),
          new Paragraph({
            children: [
              new TextRun({
                text: `Questions probables (${questions.length})`,
                bold: true,
                size: 26,
              }),
            ],
            spacing: { before: 240, after: 120 },
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                tableHeader: true,
                children: [
                  cell('N°', { bold: true, fill: 'EDE9FE', w: 5 }),
                  cell('Question', { bold: true, fill: 'EDE9FE', w: 30 }),
                  cell('Éléments de réponse', { bold: true, fill: 'EDE9FE', w: 50 }),
                  cell('Renvoi', { bold: true, fill: 'EDE9FE', w: 15 }),
                ],
              }),
              ...questions.map(
                (q, i) =>
                  new TableRow({
                    cantSplit: true,
                    children: [
                      cell(String(i + 1), { w: 5 }),
                      cell(`${q.question}\n(${ORIGINE_FR[q.origine] ?? q.origine})`, { w: 30 }),
                      cell(q.reponse, { w: 50 }),
                      cell(q.renvoi ? `Section ${q.renvoi}` : '—', { w: 15 }),
                    ],
                  }),
              ),
            ],
          }),
          new Paragraph({ alignment: AlignmentType.LEFT, children: [] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
