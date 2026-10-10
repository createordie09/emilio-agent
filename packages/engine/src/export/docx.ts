import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  FootnoteReferenceRun,
  HeadingLevel,
  ImageRun,
  LineRuleType,
  NumberFormat,
  Packer,
  PageNumber,
  Paragraph,
  SectionType,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type ISectionOptions,
} from 'docx';
import type { ExportConfig } from './config';
import { frenchTypography } from './typography';
import { plainOf, type Block, type DocModel, type FrontPage, type Para, type Run } from './model';

type Child = Paragraph | Table | TableOfContents;
const cm = (v: number): number => Math.round(v * 567);
const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
];

/** Générateur DOCX (CdC §16.1) : styles Word nommés, sommaire en champ TOC, notes natives, sections à pagination distincte. */
export async function buildDocx(doc: DocModel, cfg: ExportConfig): Promise<Buffer> {
  const L = doc.layout;
  const font = L.font;
  const size = Math.round(L.fontSize * 2);
  const line = Math.round(240 * L.lineSpacing);
  const justify = L.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT;

  const run = (r: Run, extra: { size?: number; italics?: boolean; bold?: boolean } = {}) =>
    r.note
      ? new FootnoteReferenceRun(r.note)
      : new TextRun({
          text: r.text,
          bold: r.bold || extra.bold,
          italics: r.italic || extra.italics,
          superScript: r.sup,
          subScript: r.sub,
          ...(r.highlight ? { highlight: 'yellow' as const } : {}),
          ...(extra.size ? { size: extra.size } : {}),
        });
  const runs = (p: Para, extra?: Parameters<typeof run>[1]) => p.map((r) => run(r, extra));

  const para = (b: Extract<Block, { type: 'paragraph' }>): Paragraph =>
    new Paragraph({
      children: runs(b.runs),
      style: b.style === 'quote' ? 'Quote' : undefined,
      alignment: justify,
      indent: b.style === 'quote' ? undefined : { firstLine: cm(L.paragraphIndent) },
      spacing: { line, lineRule: LineRuleType.AUTO, after: 120 },
    });

  const caption = (text: string): Paragraph =>
    new Paragraph({
      style: 'Caption',
      keepNext: true,
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text, bold: true })],
    });
  const source = (text: string): Paragraph =>
    new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ text, italics: true, size: cfg.docx.sourceSizePt * 2 })],
    });

  const table = (b: Extract<Block, { type: 'table' }>): Child[] => {
    const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
    const borders = { top: border, bottom: border, left: border, right: border };
    const cell = (t: string, head: boolean, first: boolean) =>
      new TableCell({
        borders,
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 40, bottom: 40, left: 80, right: 80 },
        ...(head ? { shading: { type: ShadingType.CLEAR, fill: 'EDE9FE', color: 'auto' } } : {}),
        children: [
          new Paragraph({
            alignment: first ? AlignmentType.LEFT : AlignmentType.CENTER,
            children: [
              new TextRun({ text: frenchTypography(t), bold: head, size: Math.max(18, size - 4) }),
            ],
          }),
        ],
      });
    const t = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          cantSplit: true,
          children: b.headers.map((h, i) => cell(h, true, i === 0)),
        }),
        ...b.rows.map(
          (r) =>
            new TableRow({
              cantSplit: true,
              children: b.headers.map((_h, i) => cell(r[i] ?? '', false, i === 0)),
            }),
        ),
      ],
    });
    return b.number > 0
      ? [
          caption(frenchTypography(`Tableau ${b.number} : ${b.caption}`)),
          t,
          source(frenchTypography(b.source)),
          new Paragraph({ children: [] }),
        ]
      : [t, new Paragraph({ children: [] })];
  };

  const figure = (b: Extract<Block, { type: 'figure' }>): Paragraph[] => {
    if (!b.png)
      return [
        new Paragraph({
          children: [
            new TextRun({
              text: `[À COMPLÉTER : figure ${b.number} indisponible]`,
              highlight: 'yellow',
            }),
          ],
        }),
        caption(frenchTypography(`Figure ${b.number} : ${b.caption}`)),
      ];
    const w = 430;
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        keepNext: true,
        children: [
          new ImageRun({
            type: 'png',
            data: b.png,
            transformation: { width: w, height: Math.round((w * b.height) / b.width) },
            altText: {
              title: `Figure ${b.number}`,
              description: b.caption,
              name: `figure-${b.number}`,
            },
          }),
        ],
      }),
      new Paragraph({
        style: 'Caption',
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: frenchTypography(`Figure ${b.number} : ${b.caption}`), bold: true }),
        ],
      }),
      source(frenchTypography(b.source)),
    ];
  };

  const blocks = (bs: Block[]): Child[] =>
    bs.flatMap((b): Child[] => {
      switch (b.type) {
        case 'heading':
          return [
            new Paragraph({
              heading: HEADINGS[b.level - 1],
              pageBreakBefore: b.pageBreak,
              children: [
                new TextRun({
                  text: b.numbering
                    ? `${b.numbering} ${frenchTypography(b.text)}`.replace(
                        /^(Partie|Chapitre) (\S+) /,
                        '$1 $2 : ',
                      )
                    : frenchTypography(b.text),
                }),
              ],
            }),
          ];
        case 'paragraph':
          return [para(b)];
        case 'list':
          return b.items.map(
            (it) =>
              new Paragraph({
                children: runs(it),
                numbering: { reference: b.ordered ? 'numbered' : 'bullets', level: 0 },
                alignment: justify,
                spacing: { line, lineRule: LineRuleType.AUTO, after: 60 },
              }),
          );
        case 'table':
          return table(b);
        case 'figure':
          return figure(b);
        case 'pagebreak':
          return [new Paragraph({ pageBreakBefore: true, children: [] })];
      }
    });

  const page = (p: FrontPage, first: boolean): Child[] => {
    if (p.key === 'sommaire')
      return [
        new Paragraph({
          pageBreakBefore: !first,
          style: 'TocTitle',
          children: [new TextRun({ text: 'Sommaire' })],
        }),
        new TableOfContents('Sommaire', {
          hyperlink: true,
          headingStyleRange: `1-${cfg.docx.tocLevels}`,
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: 'Ce sommaire se met à jour à l’ouverture du document : acceptez la mise à jour des champs si Word la propose.',
              italics: true,
              size: 18,
            }),
          ],
        }),
      ];
    return [
      new Paragraph({
        heading: HEADINGS[0],
        pageBreakBefore: !first,
        children: [new TextRun({ text: p.title })],
      }),
      ...blocks(p.blocks),
    ];
  };

  const pageProps = (numbered: 'lower' | 'decimal' | null) => ({
    page: {
      size: { width: 11906, height: 16838 },
      margin: {
        top: cm(L.margins.top),
        bottom: cm(L.margins.bottom),
        left: cm(L.margins.left),
        right: cm(L.margins.right),
      },
      ...(numbered
        ? {
            pageNumbers: {
              start: 1,
              formatType: numbered === 'lower' ? NumberFormat.LOWER_ROMAN : NumberFormat.DECIMAL,
            },
          }
        : {}),
    },
  });
  const footer = () =>
    new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ children: [PageNumber.CURRENT] })],
        }),
      ],
    });

  const sections: ISectionOptions[] = [];
  if (doc.cover) {
    const roleStyle: Record<
      string,
      { size: number; bold: boolean; before: number; after: number }
    > = {
      type: { size: 32, bold: true, before: 1200, after: 200 },
      title: { size: 40, bold: true, before: 400, after: 600 },
      meta: { size: 26, bold: false, before: 100, after: 100 },
      person: { size: 26, bold: false, before: 200, after: 100 },
    };
    sections.push({
      properties: pageProps(null),
      children: doc.cover.lines.map((l) => {
        const s = roleStyle[l.role]!;
        return new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: s.before, after: s.after },
          children: [
            new TextRun({
              text: frenchTypography(l.text),
              size: s.size,
              bold: s.bold,
              ...(l.highlight ? { highlight: 'yellow' as const } : {}),
            }),
          ],
        });
      }),
    });
  }
  if (doc.front.length) {
    sections.push({
      properties: { ...pageProps('lower'), type: SectionType.NEXT_PAGE },
      footers: { default: footer() },
      children: doc.front.flatMap((p, i) => page(p, i === 0)),
    });
  }
  const bodyChildren: Child[] = [...blocks(doc.body)];
  bodyChildren.push(
    new Paragraph({
      heading: HEADINGS[0],
      pageBreakBefore: true,
      children: [new TextRun({ text: doc.bibliography.title })],
    }),
  );
  for (const g of doc.bibliography.groups) {
    if (g.label)
      bodyChildren.push(
        new Paragraph({ heading: HEADINGS[1], children: [new TextRun({ text: g.label })] }),
      );
    for (const e of g.entries)
      bodyChildren.push(
        new Paragraph({
          children: runs(e),
          alignment: AlignmentType.LEFT,
          indent: { left: cm(1.25), hanging: cm(1.25) },
          spacing: { after: 100, line: 276, lineRule: LineRuleType.AUTO },
        }),
      );
  }
  doc.annexes.forEach((a) => bodyChildren.push(...page({ ...a, key: a.key }, false)));
  sections.push({
    properties: { ...pageProps('decimal'), type: SectionType.NEXT_PAGE },
    footers: { default: footer() },
    children: bodyChildren,
  });

  const footnotes: Record<number, { children: Paragraph[] }> = {};
  for (const [k, p] of doc.footnotes)
    footnotes[k] = {
      children: [
        new Paragraph({ children: runs(p, { size: Math.round(L.footnotesFontSize * 2) }) }),
      ],
    };

  const hfont = cfg.docx.headingFont;
  const d = new Document({
    creator: 'emilio agent',
    title: doc.title,
    features: { updateFields: true },
    footnotes,
    styles: {
      default: {
        document: {
          run: { font, size, language: { value: 'fr-FR' } },
          paragraph: { spacing: { line, lineRule: LineRuleType.AUTO } },
        },
        heading1: {
          run: { font: hfont, size: 32, bold: true, color: '000000' },
          paragraph: { spacing: { before: 240, after: 240 } },
        },
        heading2: {
          run: { font: hfont, size: 28, bold: true, color: '000000' },
          paragraph: { spacing: { before: 240, after: 120 } },
        },
        heading3: {
          run: { font: hfont, size: 26, bold: true, color: '000000' },
          paragraph: { spacing: { before: 200, after: 100 } },
        },
        heading4: {
          run: { font: hfont, size: 24, bold: true, italics: true, color: '000000' },
          paragraph: { spacing: { before: 160, after: 80 } },
        },
      },
      paragraphStyles: [
        {
          id: 'Caption',
          name: 'caption',
          basedOn: 'Normal',
          next: 'Normal',
          run: { size: cfg.docx.captionSizePt * 2, bold: true },
          paragraph: { spacing: { before: 120, after: 80 } },
        },
        {
          id: 'Quote',
          name: 'Quote',
          basedOn: 'Normal',
          next: 'Normal',
          run: { italics: true },
          paragraph: {
            indent: { left: cm(1.25), right: cm(1.25) },
            alignment: justify,
            spacing: { after: 120 },
          },
        },
        {
          id: 'TocTitle',
          name: 'TOC Heading',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: hfont, size: 32, bold: true },
          paragraph: { spacing: { after: 240 } },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            {
              level: 0,
              format: NumberFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
        {
          reference: 'numbered',
          levels: [
            {
              level: 0,
              format: NumberFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections,
  });
  return Packer.toBuffer(d);
}

export const docPlain = (doc: DocModel): string =>
  [...doc.front, ...doc.annexes]
    .flatMap((p) => p.blocks)
    .concat(doc.body)
    .map((b) => (b.type === 'paragraph' ? plainOf(b.runs) : ''))
    .join('\n');
