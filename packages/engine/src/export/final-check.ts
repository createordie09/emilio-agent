import { readFileSync } from 'node:fs';
import type { FinalCheckItem, FinalCheckView } from '@emilio/shared';
import type { ExportConfig } from './config';
import { plainOf, type Block, type DocModel } from './model';

/** Relit le DOCX produit (§16.5 : « s'ouvre sans erreur ») : archive valide, texte extractible, titre présent. */
export async function reopenDocx(
  path: string,
  title: string,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const mammoth = await import('mammoth');
    const r = await mammoth.extractRawText({ buffer: readFileSync(path) });
    const text = r.value.replace(/\s+/g, ' ');
    if (text.length < 200)
      return {
        ok: false,
        detail: 'Le fichier Word s’ouvre mais son contenu est vide ou trop court.',
      };
    const t = title.replace(/\s+/g, ' ').slice(0, 30);
    if (!text.includes(t.replace(/[’']/g, '’')) && !text.includes(t))
      return {
        ok: true,
        detail:
          'Le fichier s’ouvre ; le titre n’a pas été retrouvé tel quel (page de garde absente ?).',
      };
    return {
      ok: true,
      detail: `Le fichier s’ouvre sans erreur (${Math.round(text.length / 1000)} k caractères de texte).`,
    };
  } catch (e) {
    return { ok: false, detail: `Le fichier Word ne s’ouvre pas : ${(e as Error).message}` };
  }
}

const sequence = (nums: number[]): boolean => {
  const s = [...nums].sort((a, b) => a - b);
  return s.every((n, i) => n === i + 1);
};

/** Contrôle final automatique (CdC §16.5). Le résultat est conservé et repris dans le rapport de mission. */
export function finalCheck(
  doc: DocModel,
  cfg: ExportConfig['finalCheck'],
  docx: { requested: boolean; result: { ok: boolean; detail: string } | null },
  now: string,
): FinalCheckView {
  const items: FinalCheckItem[] = [];
  const add = (
    id: string,
    label: string,
    status: FinalCheckItem['status'],
    detail: string | null,
  ) => items.push({ id, label, status, detail });
  const st = doc.stats;

  add(
    'marqueurs',
    'Aucun marqueur de citation non résolu',
    st.unresolvedMarkers.length ? 'echec' : 'ok',
    st.unresolvedMarkers.length
      ? `${st.unresolvedMarkers.length} marqueur(s) inconnu(s) ou mal formé(s), retirés du texte : ${st.unresolvedMarkers.slice(0, 3).join(' ')}`
      : null,
  );

  const cited = new Set(st.citedSourceIds);
  const bib = new Set(st.bibliographyIds);
  const missing = [...cited].filter((x) => !bib.has(x));
  const extra = [...bib].filter((x) => !cited.has(x));
  add(
    'bibliographie',
    'Sources citées = bibliographie',
    missing.length || extra.length ? 'echec' : 'ok',
    missing.length || extra.length
      ? `${missing.length} source(s) citée(s) absente(s) de la bibliographie, ${extra.length} source(s) listée(s) mais non citée(s).`
      : `${cited.size} source(s) citée(s), toutes dans la bibliographie.`,
  );

  add(
    'ancrage',
    `Taux d’ancrage global ≥ ${Math.round(cfg.groundingMin * 100)} %`,
    st.groundingRate === null
      ? 'avertissement'
      : st.groundingRate >= cfg.groundingMin
        ? 'ok'
        : 'avertissement',
    st.groundingRate === null
      ? 'Taux d’ancrage non mesuré.'
      : `Taux d’ancrage moyen : ${Math.round(st.groundingRate * 100)} %.`,
  );

  const ratio = st.wordsTarget ? st.words / st.wordsTarget : 1;
  add(
    'longueur',
    `Longueur totale dans la tolérance (± ${Math.round(cfg.lengthTolerance * 100)} %)`,
    Math.abs(ratio - 1) <= cfg.lengthTolerance ? 'ok' : 'avertissement',
    `${st.words.toLocaleString('fr-FR')} mots rédigés pour ${st.wordsTarget.toLocaleString('fr-FR')} visés (${Math.round(ratio * 100)} %).`,
  );

  const all: Block[] = [...doc.body, ...doc.annexes.flatMap((a) => a.blocks)];
  const tabs = all
    .filter((b) => b.type === 'table' && b.number > 0)
    .map((b) => (b as { number: number }).number);
  const figs = all.filter((b) => b.type === 'figure').map((b) => (b as { number: number }).number);
  add(
    'numerotation',
    'Numérotation des tableaux et des figures continue',
    sequence(tabs) && sequence(figs) ? 'ok' : 'echec',
    `${tabs.length} tableau(x), ${figs.length} figure(s).`,
  );
  const text = [...doc.body, ...doc.front.flatMap((f) => f.blocks)]
    .map((b) =>
      b.type === 'paragraph'
        ? plainOf(b.runs)
        : b.type === 'list'
          ? b.items.map(plainOf).join(' ')
          : '',
    )
    .join(' ');
  const dangling = new Set<string>();
  for (const m of text.matchAll(/\bTableau\s+(\d+)\b/g))
    if (!tabs.includes(Number(m[1]))) dangling.add(`Tableau ${m[1]}`);
  for (const m of text.matchAll(/\bFigure\s+(\d+)\b/g))
    if (!figs.includes(Number(m[1]))) dangling.add(`Figure ${m[1]}`);
  if (dangling.size)
    add(
      'renvois',
      'Renvois vers les tableaux et figures',
      'avertissement',
      `Renvoi(s) vers un élément absent du document : ${[...dangling].join(', ')}.`,
    );

  if (st.deletedMissing.length)
    add(
      'sections',
      'Toutes les sections sont rédigées',
      'avertissement',
      `Section(s) non rédigée(s) : ${st.deletedMissing.join(' ; ')}.`,
    );

  add(
    'emplacements',
    'Emplacements à compléter',
    st.placeholders.length ? 'avertissement' : 'ok',
    st.placeholders.length
      ? `${st.placeholders.length} emplacement(s) à compléter par vous (listés ci-dessous).`
      : 'Aucun emplacement à compléter.',
  );

  if (docx.requested)
    add(
      'docx',
      'Le fichier Word s’ouvre sans erreur',
      docx.result?.ok ? 'ok' : 'echec',
      docx.result?.detail ?? 'Fichier Word non produit.',
    );

  return {
    at: now,
    ok: !items.some((i) => i.status === 'echec'),
    items,
    placeholders: st.placeholders,
  };
}
