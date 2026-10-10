import PptxGenJS from 'pptxgenjs';
import type { ExportConfig } from './config';
import type { FigureBlock, TableBlock } from './model';
import { frenchTypography } from './typography';

export type FinalSlide = {
  type: string;
  titre: string;
  puces: string[];
  notes: string;
  table?: TableBlock | null;
  figure?: FigureBlock | null;
  /** Texte à compléter (surligné). */
  placeholders?: string[];
  subtitle?: string[];
};

/** Diaporama de soutenance (CdC §16.3) : gabarit sobre, une couleur d'accent configurable, notes de l'orateur sur chaque diapositive. */
export async function buildPptx(
  slides: FinalSlide[],
  title: string,
  cfg: ExportConfig['pptx'],
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = title;
  pptx.author = 'emilio agent';
  const W = 13.33;
  const accent = cfg.accentColor;
  const font = cfg.fontFace;

  slides.forEach((s, idx) => {
    const sl = pptx.addSlide();
    sl.background = { color: cfg.backgroundColor };
    if (s.type === 'titre') {
      sl.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: 0.35,
        h: 7.5,
        fill: { color: accent },
        line: { color: accent },
      });
      sl.addText(frenchTypography(s.titre), {
        x: 1,
        y: 1.6,
        w: W - 2,
        h: 2.2,
        fontFace: font,
        fontSize: 36,
        bold: true,
        color: cfg.textColor,
        valign: 'middle',
      });
      sl.addText(
        (s.subtitle ?? []).map((t, i, a) => ({
          text: frenchTypography(t) + (i < a.length - 1 ? '\n' : ''),
          options: t.startsWith('[À COMPLÉTER') ? { highlight: 'FFFF00' } : {},
        })),
        {
          x: 1,
          y: 4.2,
          w: W - 2,
          h: 2,
          fontFace: font,
          fontSize: 18,
          color: cfg.mutedColor,
          valign: 'top',
        },
      );
    } else {
      sl.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: W,
        h: 0.12,
        fill: { color: accent },
        line: { color: accent },
      });
      sl.addText(frenchTypography(s.titre), {
        x: 0.7,
        y: 0.35,
        w: W - 1.4,
        h: 0.9,
        fontFace: font,
        fontSize: 28,
        bold: true,
        color: cfg.textColor,
        valign: 'middle',
      });
      const hasVisual = Boolean(s.table || s.figure?.png);
      const bw = hasVisual ? 5.2 : W - 1.4;
      if (s.puces.length)
        sl.addText(
          s.puces.map((p) => ({
            text: frenchTypography(p),
            options: { bullet: { indent: 18 }, breakLine: true, paraSpaceAfter: 8 },
          })),
          {
            x: 0.7,
            y: 1.5,
            w: bw,
            h: 5,
            fontFace: font,
            fontSize: hasVisual ? 18 : 22,
            color: cfg.textColor,
            valign: 'top',
          },
        );
      if (s.table) {
        const rows = [s.table.headers, ...s.table.rows.slice(0, 9)].map((r, ri) =>
          r.map((c) => ({
            text: frenchTypography(c),
            options: {
              bold: ri === 0,
              fontSize: 12,
              fontFace: font,
              color: cfg.textColor,
              ...(ri === 0 ? { fill: { color: 'EDE9FE' } } : {}),
              border: { type: 'solid' as const, color: 'BBBBBB', pt: 0.5 },
            },
          })),
        );
        sl.addTable(rows, { x: 6.3, y: 1.6, w: W - 6.9 });
        if (s.table.number > 0)
          sl.addText(frenchTypography(`Tableau ${s.table.number} : ${s.table.caption}`), {
            x: 6.3,
            y: 6.3,
            w: W - 6.9,
            h: 0.6,
            fontFace: font,
            fontSize: 11,
            italic: true,
            color: cfg.mutedColor,
          });
      } else if (s.figure?.png) {
        sl.addImage({
          data: `image/png;base64,${Buffer.from(s.figure.png).toString('base64')}`,
          x: 6.3,
          y: 1.6,
          w: W - 6.9,
          h: ((W - 6.9) * s.figure.height) / s.figure.width,
        });
        sl.addText(frenchTypography(`Figure ${s.figure.number} : ${s.figure.caption}`), {
          x: 6.3,
          y: 6.3,
          w: W - 6.9,
          h: 0.6,
          fontFace: font,
          fontSize: 11,
          italic: true,
          color: cfg.mutedColor,
        });
      }
      if (s.placeholders?.length)
        sl.addText(
          s.placeholders.map((t) => ({
            text: t,
            options: { highlight: 'FFFF00', breakLine: true },
          })),
          { x: 0.7, y: 6.3, w: 7, h: 0.8, fontFace: font, fontSize: 14, color: cfg.textColor },
        );
      sl.addText(String(idx + 1), {
        x: W - 1.2,
        y: 6.95,
        w: 0.6,
        h: 0.35,
        fontFace: font,
        fontSize: 11,
        color: cfg.mutedColor,
        align: 'right',
      });
    }
    sl.addNotes(s.notes);
  });
  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
}
