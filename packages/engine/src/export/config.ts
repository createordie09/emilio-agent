import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '@emilio/shared';

export type CitationMode = 'auteur_date' | 'notes' | 'numerique';
export type StyleDef = { file: string; mode: CitationMode; label: string };
export type ExportProfile = {
  style: string;
  ibidem: boolean;
  bibliography: { groupByType: boolean; title: string };
  layout: {
    margins: { top: number; bottom: number; left: number; right: number };
    paragraphIndent: number;
    headingNumbering: 'decimal' | 'romain_alphabetique';
    footnotesFontSize: number;
  };
  personne: 'nous' | 'impersonnel';
};
export type BibGroup = { id: string; label: string; types: string[] };
export type ProfilesFile = {
  defaultProfileId: string;
  styles: Record<string, StyleDef>;
  locale: string;
  bibliographyGroups: BibGroup[];
  profiles: Record<string, ExportProfile>;
  fallbackStyleForMode: Record<'auteur_date' | 'notes', string>;
};

export type ExportConfig = {
  docx: { headingFont: string; captionSizePt: number; sourceSizePt: number; tocLevels: number };
  pdf: { pageCss: string; tocPageNumbers: boolean };
  pptx: {
    accentColor: string;
    textColor: string;
    mutedColor: string;
    backgroundColor: string;
    fontFace: string;
    maxBulletsPerSlide: number;
    maxWordsPerBullet: number;
    defaultSlides: number;
    notesWordsMax: number;
  };
  fiche: { questionsMin: number; questionsMax: number };
  finalCheck: { groundingMin: number; lengthTolerance: number };
  sigles: { minLetters: number; maxLetters: number; minOccurrences: number };
  charts: {
    width: number;
    height: number;
    barColor: string;
    textColor: string;
    gridColor: string;
    fontFile: string;
    boldFontFile: string;
  };
};

export const DEFAULT_EXPORT_CONFIG: ExportConfig = {
  docx: { headingFont: 'Times New Roman', captionSizePt: 10, sourceSizePt: 9, tocLevels: 3 },
  pdf: { pageCss: 'A4', tocPageNumbers: true },
  pptx: {
    accentColor: '6D4AE0',
    textColor: '1F2937',
    mutedColor: '6B7280',
    backgroundColor: 'FFFFFF',
    fontFace: 'Calibri',
    maxBulletsPerSlide: 5,
    maxWordsPerBullet: 12,
    defaultSlides: 15,
    notesWordsMax: 220,
  },
  fiche: { questionsMin: 20, questionsMax: 30 },
  finalCheck: { groundingMin: 0.9, lengthTolerance: 0.15 },
  sigles: { minLetters: 2, maxLetters: 8, minOccurrences: 1 },
  charts: {
    width: 640,
    height: 360,
    barColor: '#6D4AE0',
    textColor: '#1F2937',
    gridColor: '#E5E7EB',
    fontFile: 'fonts/Inter-Regular.ttf',
    boldFontFile: 'fonts/Inter-Bold.ttf',
  },
};

export function loadExportConfig(resourcesDir: string | undefined): ExportConfig {
  const p = resourcesDir ? join(resourcesDir, 'export-config.json') : '';
  const f =
    p && existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Partial<ExportConfig>) : {};
  const d = DEFAULT_EXPORT_CONFIG;
  return {
    docx: { ...d.docx, ...f.docx },
    pdf: { ...d.pdf, ...f.pdf },
    pptx: { ...d.pptx, ...f.pptx },
    fiche: { ...d.fiche, ...f.fiche },
    finalCheck: { ...d.finalCheck, ...f.finalCheck },
    sigles: { ...d.sigles, ...f.sigles },
    charts: { ...d.charts, ...f.charts },
  };
}

export function loadExportProfiles(resourcesDir: string | undefined): ProfilesFile {
  const p = resourcesDir ? join(resourcesDir, 'export-profiles.json') : '';
  if (!p || !existsSync(p))
    throw new AppError(
      'E_ENGINE',
      'Les fichiers de mise en forme (profils de normes) sont introuvables : réinstallez l’application.',
    );
  return JSON.parse(readFileSync(p, 'utf8')) as ProfilesFile;
}

/** Profil effectif : celui du brief, ou le profil par défaut ; le style de citation choisi dans le brief peut en changer le mode. */
export function resolveProfile(
  file: ProfilesFile,
  profilNormesId: string | undefined,
  styleCitation: 'auteur_date' | 'notes' | undefined,
): { id: string; profile: ExportProfile; styleKey: string; style: StyleDef } {
  const id =
    profilNormesId && file.profiles[profilNormesId] ? profilNormesId : file.defaultProfileId;
  const profile = file.profiles[id]!;
  let styleKey = profile.style;
  const mode = file.styles[styleKey]!.mode;
  // Le choix « notes » / « auteur-date » du brief l'emporte sur le mode du profil (les numériques restent numériques).
  if (styleCitation && mode !== 'numerique' && mode !== styleCitation)
    styleKey = file.fallbackStyleForMode[styleCitation];
  return { id, profile, styleKey, style: file.styles[styleKey]! };
}
