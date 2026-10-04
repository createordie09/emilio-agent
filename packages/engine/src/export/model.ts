/** Modèle de document intermédiaire (CdC §9 P8) : indépendant du format (DOCX, HTML/PDF), construit par `assemble.ts`. */

export type Run = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  sup?: boolean;
  sub?: boolean;
  /** Emplacement à compléter : surligné en jaune (§16.1). */
  highlight?: boolean;
  /** Renvoi vers une note de bas de page (numéro dans `DocModel.footnotes`). */
  note?: number;
};

export type Para = Run[];

export type TableBlock = {
  type: 'table';
  number: number;
  caption: string;
  source: string;
  headers: string[];
  rows: string[][];
};

export type FigureBlock = {
  type: 'figure';
  number: number;
  caption: string;
  source: string;
  png: Uint8Array | null;
  svg: string | null;
  width: number;
  height: number;
};

export type Block =
  | {
      type: 'heading';
      level: 1 | 2 | 3 | 4;
      id: string;
      numbering: string | null;
      text: string;
      pageBreak: boolean;
      toc: boolean;
    }
  | { type: 'paragraph'; runs: Para; style?: 'normal' | 'quote' }
  | { type: 'list'; items: Para[]; ordered: boolean }
  | TableBlock
  | FigureBlock
  | { type: 'pagebreak' };

export type FrontPage = {
  key: string;
  title: string;
  blocks: Block[];
  /** Apparaît dans le sommaire. */
  toc: boolean;
};

export type BibliographyGroup = { label: string | null; entries: Para[] };

export type DocModel = {
  title: string;
  subtitle: string | null;
  language: 'fr';
  cover: {
    lines: { text: string; role: 'type' | 'title' | 'meta' | 'person'; highlight?: boolean }[];
  } | null;
  layout: {
    font: string;
    fontSize: number;
    lineSpacing: number;
    margins: { top: number; bottom: number; left: number; right: number };
    paragraphIndent: number;
    justify: boolean;
    footnotesFontSize: number;
  };
  front: FrontPage[];
  /** Sommaire demandé (le contenu est calculé par le format de sortie). */
  tocRequested: boolean;
  body: Block[];
  bibliography: { title: string; groups: BibliographyGroup[]; numbered: boolean };
  annexes: FrontPage[];
  /** Notes de bas de page (mode « notes ») : numéro → contenu. */
  footnotes: Map<number, Para>;
  notesMode: boolean;
  /** Informations pour le contrôle final (§16.5). */
  stats: {
    citedSourceIds: string[];
    bibliographyIds: string[];
    unresolvedMarkers: string[];
    tablesPlaced: number[];
    figuresPlaced: number[];
    placeholders: { section: string; text: string }[];
    words: number;
    wordsTarget: number;
    groundingRate: number | null;
    deletedMissing: string[];
  };
};

export const plainOf = (runs: Para): string => runs.map((r) => r.text).join('');
