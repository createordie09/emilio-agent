import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectIdentifying,
  profileDataFile,
  Pseudonymizer,
  scrubContacts,
  validateAnalysisPlan,
  baselineSpecs,
  type LlmRequest,
} from '../src';
import type { MissionFileInfo } from '@emilio/shared';
import { dataProfileText } from '../src/planning/brief-text';
import { runMission, base } from './pipeline';

const rows = Array.from({ length: 40 }, (_, i) => ({
  nom: ['Zéphirin Takpara', 'Odile Ahouandjinou', 'Prosper Gbaguidi', 'Chantal Dossou'][i % 4]!,
  tel: `+229 97 0${i % 10} 12 3${i % 10}`,
  mail: `p${i}@exemple.bj`,
  sexe: i % 3 ? 'Femme' : 'Homme',
  age: String(20 + (i % 30)),
  ville: ['Cotonou', 'Parakou'][i % 2]!,
  code: `ENQ-${1000 + i}A`,
}));
function csv(): string {
  const dir = mkdtempSync(join(tmpdir(), 'emilio-priv-'));
  const p = join(dir, 'donnees.csv');
  const head = 'Nom et prénom,Téléphone,Courriel,Sexe,Âge,Ville,Référence';
  writeFileSync(
    p,
    [
      head,
      ...rows.map((r) => [r.nom, r.tel, r.mail, r.sexe, r.age, r.ville, r.code].join(',')),
    ].join('\n'),
  );
  return p;
}

describe('colonnes d’identification (§19)', () => {
  it('détection par l’intitulé et par le contenu', () => {
    expect(detectIdentifying('Nom et prénom', []).identifying).toBe(true);
    expect(detectIdentifying('Téléphone', []).identifying).toBe(true);
    expect(detectIdentifying('E-mail', []).identifying).toBe(true);
    expect(detectIdentifying('Date de naissance', []).identifying).toBe(true);
    // Mal nommée : le contenu trahit la colonne.
    expect(
      detectIdentifying(
        'Colonne 4',
        rows.map((r) => r.mail),
      ).reason,
    ).toBe('adresses e-mail');
    expect(
      detectIdentifying(
        'Contact',
        rows.map((r) => r.tel),
      ).reason,
    ).toBe('numéros de téléphone');
    expect(
      detectIdentifying(
        'Réf',
        rows.map((r) => r.code),
      ).identifying,
    ).toBe(true);
    // Variables d'analyse légitimes : jamais écartées.
    for (const n of [
      'Sexe',
      'Âge',
      'Ville',
      'Revenu mensuel (FCFA)',
      'Nombre de crédits',
      'Crédit obtenu',
      'Niveau d’instruction',
    ])
      expect(
        detectIdentifying(n, ['Femme', 'Homme', 'Femme', 'Homme', 'Femme']).identifying,
        n,
      ).toBe(false);
  });

  it('le profil ne garde rien d’une colonne d’identification : ni modalités, ni statistiques, ni valeurs d’échantillon', async () => {
    const p = await profileDataFile(csv(), 'donnees.csv');
    const ident = p.columns.filter((c) => c.identifying).map((c) => c.name);
    expect(ident.sort()).toEqual(['Courriel', 'Nom et prénom', 'Référence', 'Téléphone'].sort());
    for (const c of p.columns.filter((c) => c.identifying)) {
      expect(c.modalities).toBeUndefined();
      expect(c.numeric).toBeUndefined();
    }
    expect(JSON.stringify(p)).not.toMatch(/Takpara|Ahouandjinou|@exemple|\+229|ENQ-/);
    expect(p.warnings.join(' ')).toMatch(/Colonne\(s\) d'identification/);
    expect(p.columns.find((c) => c.name === 'Sexe')?.modalities?.length).toBe(2);
  });

  it('une colonne d’identification n’est jamais analysable ni proposée en analyse de base', async () => {
    const p = await profileDataFile(csv(), 'donnees.csv');
    const plan = validateAnalysisPlan(
      {
        analyses: [
          { type: 'frequencies', variables: ['Nom et prénom'], hypothese: null },
          { type: 'crosstab', variables: ['Sexe', 'Téléphone'], hypothese: null },
          { type: 'frequencies', variables: ['Sexe'], hypothese: null },
        ],
      } as never,
      p,
      10,
    );
    expect(plan.specs.map((s) => s.variables.join('+'))).toEqual(['Sexe']);
    expect(plan.dropped).toHaveLength(2);
    expect(baselineSpecs(p).flatMap((s) => s.variables)).not.toContain('Nom et prénom');
  });

  it('le texte envoyé au modèle pour le cadrage ne nomme pas les colonnes d’identification', async () => {
    const p = await profileDataFile(csv(), 'donnees.csv');
    const txt = dataProfileText([
      { kind: 'field_data', filename: 'donnees.csv', profile: p } as MissionFileInfo,
    ]);
    expect(txt).toContain('Sexe');
    expect(txt).not.toMatch(/Nom et prénom|Téléphone|Courriel/);
  });
});

describe('pseudonymisation (§19)', () => {
  it('E1, E2… pour les personnes (variantes comprises), contacts masqués', () => {
    const ps = new Pseudonymizer();
    ps.register(['Koffi Adjovi', 'Adjovi', 'Koffi']);
    ps.register('Aïcha Bio');
    const out = ps.apply(
      'Koffi Adjovi dit : « Adjovi a contacté Aïcha Bio » (koffi@exemple.bj, +229 97 00 12 34). Bio n’est pas Biologie.',
    );
    expect(out).toBe(
      'E1 dit : « E1 a contacté E2 » ([e-mail masqué], [numéro masqué]). Bio n’est pas Biologie.',
    );
    expect(ps.mapping()).toEqual({ E1: ['koffi adjovi', 'adjovi', 'koffi'], E2: ['aïcha bio'] });
  });
  it('les années, dates et DOI ne sont pas pris pour des numéros', () => {
    expect(scrubContacts('En 2021, le 2024-03-05, voir 10.1234/abcd.5678 et p. 123-145.')).toBe(
      'En 2021, le 2024-03-05, voir 10.1234/abcd.5678 et p. 123-145.',
    );
  });
});

describe('mission complète avec données identifiantes (mode simulé)', () => {
  it('aucune requête envoyée au modèle ne contient une donnée personnelle', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'emilio-priv-'));
    const file = join(dir, 'donnees-enquete.csv');
    writeFileSync(
      file,
      [
        'Nom et prénom,Téléphone,Sexe,Âge,Ville,Crédit obtenu',
        ...rows.map((r, i) =>
          [r.nom, r.tel, r.sexe, r.age, r.ville, i % 2 ? 'oui' : 'non'].join(','),
        ),
      ].join('\n'),
    );
    const seen: string[] = [];
    const respond = (req: LlmRequest) => {
      seen.push(req.messages.map((m) => m.content).join('\n'));
      return base(req);
    };
    const { engine, id } = await runMission({ data: file, respond });
    expect(engine.missions.status(id)).toBe('completed');
    expect(seen.length).toBeGreaterThan(10);
    const all = seen.join('\n');
    expect(all).toContain('Sexe'); // les variables d'analyse, elles, sont bien transmises
    const leak = /Takpara|Ahouandjinou|Gbaguidi|Dossou|\+229|Nom et prénom|Téléphone/.exec(all);
    expect(leak ? all.slice(Math.max(0, leak.index - 150), leak.index + 100) : null).toBeNull();
    // L'analyse a bien eu lieu, sans les colonnes d'identification.
    const res = engine.db
      .prepare('SELECT results_json FROM field_analysis WHERE mission_id=?')
      .get(id) as { results_json: string };
    expect(res.results_json).not.toMatch(/Nom et prénom|Téléphone/);
  }, 120_000);
});
