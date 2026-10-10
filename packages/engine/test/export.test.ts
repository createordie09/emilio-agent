import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { ExportOverview } from '@emilio/shared';
import {
  cslHtmlToRuns,
  extractSigles,
  frenchTypography,
  slideStructure,
  type PdfAdapter,
} from '../src';
import { runMission, ask } from './pipeline';

const fakePdf: PdfAdapter = {
  async render(_html, pdf) {
    writeFileSync(pdf, '%PDF-1.4\n% rendu simulé\n');
  },
};
const unzip = (file: string, entry: string): string => {
  try {
    return execFileSync('unzip', ['-p', file, entry], { maxBuffer: 64 * 1024 * 1024 }).toString(
      'utf8',
    );
  } catch {
    return '';
  }
};
const listZip = (file: string): string[] => {
  try {
    return execFileSync('unzip', ['-Z1', file]).toString('utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
};

describe('typographie française (§15.4)', () => {
  it('espaces insécables, guillemets et apostrophes', () => {
    const t = frenchTypography('Il a dit "bonjour" : oui ; non ! vraiment ? 12 % de l\'ensemble.');
    expect(t).toContain('«\u00a0bonjour\u00a0»');
    expect(t).toContain('\u00a0: oui');
    expect(t).toContain('\u202f; non');
    expect(t).toContain('\u202f!');
    expect(t).toContain('\u202f?');
    expect(t).toContain('12\u202f%');
    expect(t).toContain('l’ensemble');
  });
  it('ne touche pas aux heures ni aux adresses', () => {
    expect(frenchTypography('à 10:30 sur https://exemple.org')).toBe(
      'à 10:30 sur https://exemple.org',
    );
  });
});

describe('sortie CSL (citeproc)', () => {
  it('convertit italiques, exposants et entités', () => {
    const r = cslHtmlToRuns('Adjovi &#38; Bio. <i>Revue africaine</i>, 12<sup>e</sup>');
    expect(r.map((x) => x.text).join('')).toBe('Adjovi & Bio. Revue africaine, 12e');
    expect(r.find((x) => x.italic)?.text).toBe('Revue africaine');
    expect(r.find((x) => x.sup)?.text).toBe('e');
  });
});

describe('sigles (P8.3)', () => {
  const opts = { minLetters: 2, maxLetters: 8, minOccurrences: 1 };
  it('extrait les sigles définis dans le texte et ne définit jamais les autres', () => {
    const s = extractSigles(
      [
        'Le programme alimentaire mondial (PAM) est présent. Le PAM aide les ménages.',
        'Le FMI intervient aussi. Le FMI prête. Chapitre II.',
      ],
      opts,
    );
    expect(s.find((x) => x.sigle === 'PAM')?.definition).toMatch(/programme alimentaire mondial/i);
    expect(s.find((x) => x.sigle === 'FMI')?.definition).toBeNull();
    expect(s.find((x) => x.sigle === 'II')).toBeUndefined();
  });
});

describe('structure du diaporama (§16.3)', () => {
  it('15 diapositives par défaut, titre en premier et conclusion en dernier', () => {
    const s = slideStructure(15);
    expect(s).toHaveLength(15);
    expect(s[0]).toBe('titre');
    expect(s.at(-1)).toBe('conclusion');
    expect(s.filter((k) => k === 'resultats')).toHaveLength(2);
  });
  it('s’adapte au nombre demandé', () => {
    expect(slideStructure(20)).toHaveLength(20);
    expect(slideStructure(10)).toHaveLength(10);
    expect(slideStructure(8)).toHaveLength(8);
  });
});

const LIVRABLES = {
  docx: true,
  pdf: true,
  pptx: true,
  nbDiapos: 15,
  fichePreparation: true,
  rapportMission: true,
};

describe('P8 / P9 — livrables (mode simulé)', () => {
  it('produit Word, PDF, diaporama, fiche et rapport ; contrôle final ; mission terminée', async () => {
    const { engine, id, summary } = await runMission({
      withJury: true,
      withExport: true,
      data: true,
      pdf: fakePdf,
      brief: { livrables: LIVRABLES },
    });
    expect(summary.status).toBe('completed');
    const ov = await ask<ExportOverview>(engine, 'getExports', { id });
    expect(ov.deliverables.map((d) => d.kind)).toEqual(['docx', 'pdf', 'pptx', 'fiche', 'rapport']);
    expect(ov.bibliography?.cited).toBeGreaterThan(0);
    expect(ov.bibliography?.styleLabel).toContain('ISO 690');
    for (const d of ov.deliverables) {
      const f = await ask<{ path: string }>(engine, 'getDeliverable', { deliverableId: d.id });
      expect(existsSync(f.path)).toBe(true);
      expect(d.sizeBytes).toBeGreaterThan(10);
    }
    // Contrôle final : tout est conforme sauf les emplacements à compléter (dédicace, remerciements, page de garde).
    const fc = ov.finalCheck!;
    expect(
      fc.items.filter((i) => i.status === 'echec'),
      JSON.stringify(fc.items),
    ).toEqual([]);
    expect(fc.ok).toBe(true);
    expect(fc.items.find((i) => i.id === 'marqueurs')?.status).toBe('ok');
    expect(fc.items.find((i) => i.id === 'bibliographie')?.status).toBe('ok');
    expect(fc.items.find((i) => i.id === 'numerotation')?.status).toBe('ok');
    expect(fc.items.find((i) => i.id === 'docx')?.status).toBe('ok');
    expect(fc.placeholders.some((p) => p.text.includes('dédicace'))).toBe(true);
    expect(fc.placeholders.some((p) => p.text.includes('nom de l’auteur'))).toBe(true);

    const docx = (
      await ask<{ path: string }>(engine, 'getDeliverable', {
        deliverableId: ov.deliverables[0]!.id,
      })
    ).path;
    const xml = unzip(docx, 'word/document.xml');
    if (xml) {
      expect(xml).not.toMatch(/\[@/);
      expect(xml).toContain('w:highlight w:val="yellow"');
      expect(xml).toMatch(/TOC \\h \\o/); // champ sommaire
      expect(xml).toMatch(/Tableau 1/);
      expect(xml).toMatch(/w:pgNumType[^>]*w:fmt="lowerRoman"/);
      expect(xml).toMatch(/w:pgNumType[^>]*w:fmt="decimal"/);
      expect(listZip(docx)).toContain(
        'word/media/' +
          listZip(docx)
            .find((x) => x.startsWith('word/media/'))!
            .slice(11),
      );
    }
    const styles = unzip(docx, 'word/styles.xml');
    if (styles) expect(styles).toContain('w:styleId="Heading1"');

    const pptx = (
      await ask<{ path: string }>(engine, 'getDeliverable', {
        deliverableId: ov.deliverables[2]!.id,
      })
    ).path;
    const files = listZip(pptx);
    if (files.length) {
      expect(files.filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x))).toHaveLength(15);
      expect(files.filter((x) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(x))).toHaveLength(
        15,
      );
      for (const s of files.filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x))) {
        const bullets = (unzip(pptx, s).match(/<a:buChar|<a:buAutoNum/g) ?? []).length;
        expect(bullets).toBeLessThanOrEqual(7); // 5 puces (le plan peut en avoir 7)
      }
    }
    const report = readFileSync(
      (
        await ask<{ path: string }>(engine, 'getDeliverable', {
          deliverableId: ov.deliverables[4]!.id,
        })
      ).path,
      'utf8',
    );
    expect(report).toContain('Rapport de mission');
    expect(report).toContain('Notes du jury');
    expect(report).toContain('Méthodologie de recherche documentaire');
    expect(report).toContain('Modèle de déclaration d’usage de l’IA');
    expect(report).toMatch(/Ronde 0/);
  }, 120_000);

  it('sans rendu PDF disponible : le PDF est signalé comme non produit, le reste est livré', async () => {
    const { engine, id, summary } = await runMission({
      withExport: true,
      brief: {
        livrables: { ...LIVRABLES, pptx: false, fichePreparation: false, rapportMission: false },
      },
    });
    expect(summary.status).toBe('completed');
    const ov = await ask<ExportOverview>(engine, 'getExports', { id });
    expect(ov.deliverables.map((d) => d.kind)).toEqual(['docx']);
    expect(ov.skipped.map((s) => s.kind)).toEqual(['pdf']);
    expect(ov.skipped[0]!.reasonFr).toMatch(/Word/);
  }, 120_000);

  it('mode notes : notes de bas de page natives, citations absentes du corps du texte', async () => {
    const { engine, id } = await runMission({
      withExport: true,
      brief: {
        profilNormesId: 'notes-sciences-humaines',
        styleCitation: 'notes',
        livrables: {
          ...LIVRABLES,
          pdf: false,
          pptx: false,
          fichePreparation: false,
          rapportMission: false,
        },
      },
    });
    const ov = await ask<ExportOverview>(engine, 'getExports', { id });
    expect(ov.bibliography?.notes).toBe(true);
    const docx = (
      await ask<{ path: string }>(engine, 'getDeliverable', {
        deliverableId: ov.deliverables[0]!.id,
      })
    ).path;
    const fn = unzip(docx, 'word/footnotes.xml');
    if (fn) {
      expect((fn.match(/<w:footnote /g) ?? []).length).toBeGreaterThan(2);
      expect(fn).toMatch(/Revue|Éditions|Karthala|\(20\d\d\)|20\d\d/);
    }
  }, 120_000);

  it('un marqueur de citation inconnu est retiré du texte et fait échouer le contrôle final', async () => {
    const { engine, id } = await runMission({
      withExport: true,
      brief: {
        livrables: {
          ...LIVRABLES,
          pdf: false,
          pptx: false,
          fichePreparation: false,
          rapportMission: false,
        },
      },
    });
    engine.db
      .prepare(
        `UPDATE drafts SET markdown = markdown || ' Une affirmation inventée [@00000000-0000-4000-8000-000000000000, p. 3].'
         WHERE id = (SELECT current_version_id FROM outline_nodes WHERE mission_id=? AND current_version_id IS NOT NULL LIMIT 1)`,
      )
      .run(id);
    const fc = await engine.exporter.check(id);
    expect(fc.ok).toBe(false);
    expect(fc.items.find((i) => i.id === 'marqueurs')?.status).toBe('echec');
    const doc = engine.exporter.assemble(id);
    const all = JSON.stringify(doc.body);
    expect(all).not.toContain('00000000-0000-4000');
  }, 120_000);
});
