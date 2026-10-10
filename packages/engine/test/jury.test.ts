import { describe, it, expect } from 'vitest';
import {
  AppError,
  type JuryScopeView,
  type SectionDraftDetail,
  type SectionVersionSummary,
} from '@emilio/shared';
import {
  scoreJuror,
  consolidate,
  verdictOf,
  DEFAULT_JURY_CONFIG,
  MOCK_REVISION_SIGNATURE,
  juryMockRespond,
  type LlmRequest,
} from '../src';
import { ask, drafts, runMission, type Respond } from './pipeline';

const cfg = DEFAULT_JURY_CONFIG;
const out = (scores: { critere_id: string; note: number | null }[]) => ({
  scores: scores.map((s) => ({ ...s, justification: 'x' })),
  points_forts: [],
  remarques: [],
});

describe('grille et consolidation (§13.2, §13.3)', () => {
  it('chaque juré ne note que ses critères ; total recalculé par le code sur les critères notés, ramené sur 20', () => {
    // méthodologiste : C1 (3) C4 (3) C5 (3) = 9 points possibles ; 6,75 / 9 → 15/20
    const r = scoreJuror(
      'juror_methodologist',
      out([
        { critere_id: 'C1', note: 2.25 },
        { critere_id: 'C4', note: 2.25 },
        { critere_id: 'C5', note: 2.25 },
        { critere_id: 'C7', note: 2 }, // critère d'un autre juré : ignoré
      ]),
      cfg.criteria,
    );
    expect(r.scores.map((s) => s.id)).toEqual(['C1', 'C4', 'C5']);
    expect(r.total).toBeCloseTo(15, 9);
  });
  it('critère non applicable (null) ou absent : retiré du total, pas compté comme 0 ; note hors intervalle ramenée', () => {
    const r = scoreJuror(
      'juror_form',
      {
        scores: [
          { critere_id: 'C7', note: 9, justification: '' },
          { critere_id: 'C8', note: null, justification: '' },
        ],
        points_forts: [],
        remarques: [],
        total_sur_20: 3,
      },
      cfg.criteria,
    );
    expect(r.scores.find((s) => s.id === 'C7')!.note).toBe(2); // plafonné au maximum du critère
    expect(r.scores.find((s) => s.id === 'C8')!.note).toBeNull();
    expect(r.scores.find((s) => s.id === 'C9')!.note).toBeNull();
    expect(r.total).toBe(20); // 2/2 sur le seul critère noté ; le « total_sur_20 » du modèle est ignoré
    expect(r.warnings.length).toBe(1);
    expect(scoreJuror('juror_form', out([]), cfg.criteria).total).toBe(0);
  });
  it('note par critère = moyenne des jurés qui l’évaluent (C5 : deux jurés) ; écart entre jurés', () => {
    const a = scoreJuror('juror_methodologist', out([{ critere_id: 'C5', note: 3 }]), cfg.criteria);
    const b = scoreJuror('juror_specialist', out([{ critere_id: 'C5', note: 1 }]), cfg.criteria);
    const c = consolidate([a, b], cfg.criteria);
    expect(c.criteria.find((x) => x.id === 'C5')!.avg).toBe(2);
    expect(c.criteria.find((x) => x.id === 'C1')!.avg).toBeNull();
    expect(c.total).toBeCloseTo((2 / 3) * 20, 9);
    expect(c.spread).toBeCloseTo(20 - (1 / 3) * 20, 9);
  });
  it('verdicts : ≥ seuil validé ; ≥ seuil − 3 à réviser ; en dessous à réécrire', () => {
    expect(verdictOf(14, 14, cfg)).toBe('valide');
    expect(verdictOf(13.999, 14, cfg)).toBe('valide'); // arrondi à deux décimales : 14,00 → validé
    expect(verdictOf(13.994, 14, cfg)).toBe('a_reviser');
    expect(verdictOf(13.5, 14, cfg)).toBe('a_reviser');
    expect(verdictOf(11, 14, cfg)).toBe('a_reviser');
    expect(verdictOf(10.99, 14, cfg)).toBe('a_reecrire');
  });
});

/** Fabrique de jurés truqués : `f(texte)` donne la fraction des points accordée (0–1). */
const jurors =
  (f: (texte: string, role: string) => number): Respond =>
  (req: LlmRequest) => {
    const label = req.meta?.label ?? '';
    if (!label.startsWith('jury:juror_')) return undefined;
    const prompt = req.messages[0]!.content;
    const texte = prompt.slice(prompt.indexOf('Texte à évaluer :'));
    const frac = f(texte, label.replace('jury:juror_', ''));
    const crit = [...prompt.matchAll(/^- (C\d+) : .+ \((\d+) points\)$/gm)];
    return JSON.stringify({
      scores: crit.map((m) => ({
        critere_id: m[1],
        note: Math.round(Number(m[2]) * frac * 100) / 100,
        justification: 'x',
      })),
      points_forts: [],
      remarques: ['S1', 'S2'].map((section_id, i) => ({
        id: '',
        section_id,
        localisation: 'ensemble',
        probleme: '[test] Argumentation à renforcer.',
        correction_attendue: 'Renforcer l’argumentation.',
        gravite: i === 0 ? 'majeure' : 'mineure',
        besoin_recherche: false,
      })),
    });
  };
const sigCount = (t: string) => t.split(MOCK_REVISION_SIGNATURE).length - 1;
const jury = (e: Awaited<ReturnType<typeof runMission>>['engine'], id: string) =>
  ask<JuryScopeView[]>(e, 'getJury', { id });

describe('P6 — jury par chapitre et révisions (§13.4)', () => {
  it('note insuffisante → plan de révision → recherche complémentaire → sections révisées → note relevée → chapitre validé ; toutes les versions conservées', async () => {
    const { engine, mock, id, summary } = await runMission({ withJury: true });
    expect(summary.status).toBe('completed');
    const scopes = await jury(engine, id);
    const chapters = scopes.filter((s) => s.scope === 'chapter');
    expect(chapters).toHaveLength(4);
    for (const c of chapters) {
      expect(c.status).toBe('valide');
      expect(c.rounds).toHaveLength(2);
      const [r0, r1] = c.rounds as [JuryScopeView['rounds'][0], JuryScopeView['rounds'][0]];
      expect(r0.total).toBeLessThan(14);
      expect(r0.verdict).toBe('a_reviser');
      expect(r1.total).toBeGreaterThanOrEqual(14);
      expect(r1.verdict).toBe('valide');
      expect(c.finalScore).toBe(r1.total);
      // trois jurés + un président par ronde, grille complète
      expect(r0.jurors.map((j) => j.role).sort()).toEqual([
        'juror_form',
        'juror_methodologist',
        'juror_specialist',
      ]);
      expect(r0.criteria.map((x) => x.id)).toEqual([
        'C1',
        'C2',
        'C3',
        'C4',
        'C5',
        'C6',
        'C7',
        'C8',
        'C9',
      ]);
      // plan de révision : majeures d'abord ; remarques actionnables ; recherche demandée par le spécialiste
      expect(r0.plan[0]!.severity).toBe('majeure');
      expect(r0.plan[0]!.needsResearch).toBe(true);
      expect(r0.jurors.flatMap((j) => j.remarks).every((r) => r.problem && r.expected)).toBe(true);
      // réponse apportée : sections révisées entre les deux rondes, version 1 → 2, conservée
      expect(r0.revisions.length).toBeGreaterThanOrEqual(2);
      for (const rv of r0.revisions)
        expect(rv).toMatchObject({
          kind: 'revision',
          fromVersion: 1,
          toVersion: 2,
          outcome: 'kept',
        });
      expect(c.reasons).toEqual([]);
    }
    // sections révisées : version 2 courante, version 1 conservée, texte de la révision contrôlé
    // deuxième section révisée du chapitre (la première reçoit en plus une harmonisation en P7)
    const first = chapters[0]!.rounds[0]!.revisions[1]!;
    const versions = await ask<SectionVersionSummary[]>(engine, 'listSectionVersions', {
      nodeId: first.nodeId,
    });
    expect(versions.map((v) => [v.version, v.current])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(versions[1]!.changeSummary).toContain('Révision (ronde 1)');
    const v1 = await ask<SectionDraftDetail>(engine, 'getSectionVersion', {
      draftId: versions[0]!.id,
    });
    const v2 = await ask<SectionDraftDetail>(engine, 'getSectionVersion', {
      draftId: versions[1]!.id,
    });
    expect(v1.markdown).not.toContain(MOCK_REVISION_SIGNATURE);
    expect(v2.markdown).toContain(MOCK_REVISION_SIGNATURE);
    expect(v2.checks!.removed).toEqual([]);
    expect(v2.markdown).not.toMatch(/\[@A\d+/);
    // la recherche complémentaire a eu lieu et n'a rien retiré
    const ev = engine.journal.list(id, 2000).map((e) => e.messageFr);
    expect(ev.some((m) => m.includes('recherche complémentaire'))).toBe(true);
    expect(ev.some((m) => /Jury : .* validé \(/.test(m))).toBe(true);
    // les nœuds validés
    const st = engine.db
      .prepare("SELECT COUNT(*) AS n FROM outline_nodes WHERE mission_id=? AND status='validated'")
      .get(id) as { n: number };
    expect(st.n).toBeGreaterThanOrEqual(14);
    expect(
      mock.calls.filter((c) => c.meta?.label === 'jury:president').length,
    ).toBeGreaterThanOrEqual(8);
    await engine.close();
  });

  it('seuil relevé par l’utilisateur : le seuil du brief s’applique (seuilJury 11 → aucun chapitre à réviser)', async () => {
    const { engine, id } = await runMission({
      withJury: true,
      brief: {
        execution: {
          parallelism: 3,
          rondesMaxParChapitre: 3,
          rondesMaxGlobales: 2,
          profondeurRecherche: 'normale',
          preferenceSources: 'toutes',
          preset: 'equilibre',
          budgetMaxUsd: 12,
          seuilJury: 11,
        },
      },
    });
    const chapters = (await jury(engine, id)).filter((s) => s.scope === 'chapter');
    for (const c of chapters) {
      expect(c.threshold).toBe(11);
      expect(c.rounds).toHaveLength(1);
      expect(c.status).toBe('valide');
    }
    expect(
      engine.db
        .prepare("SELECT COUNT(*) AS n FROM revision_log WHERE mission_id=? AND kind='revision'")
        .get(id),
    ).toEqual({ n: 0 });
    await engine.close();
  });

  it('une révision qui dégrade est annulée : les versions précédentes redeviennent courantes, chapitre accepté avec réserves (§13.4)', async () => {
    const { engine, id } = await runMission({
      withJury: true,
      respond: jurors((t) => (sigCount(t) > 0 ? 0.5 : 0.65)),
    });
    const chapters = (await jury(engine, id)).filter((s) => s.scope === 'chapter');
    for (const c of chapters) {
      expect(c.status).toBe('accepte_avec_reserves');
      expect(c.finalScore).toBeCloseTo(13, 5); // note d'avant la révision, conservée
      expect(c.reasons[0]).toContain('dégradait');
      expect(c.rounds).toHaveLength(2);
      for (const rv of c.rounds[0]!.revisions) expect(rv.outcome).toBe('reverted');
    }
    // version courante = version 1 ; la version 2 existe toujours dans l'historique
    const rv = chapters[0]!.rounds[0]!.revisions[1]!;
    const versions = await ask<SectionVersionSummary[]>(engine, 'listSectionVersions', {
      nodeId: rv.nodeId,
    });
    expect(versions.map((v) => [v.version, v.current])).toEqual([
      [1, true],
      [2, false],
    ]);
    const d = await ask<SectionDraftDetail>(engine, 'getSectionDraft', { nodeId: rv.nodeId });
    expect(d.version).toBe(1);
    expect(
      engine.journal.list(id, 2000).some((e) => e.messageFr.includes('a fait baisser la note')),
    ).toBe(true);
    await engine.close();
  });

  it('plateau : gain inférieur à 0,5 point → arrêt anticipé, raison enregistrée', async () => {
    const { engine, id } = await runMission({
      withJury: true,
      respond: jurors((t) => (sigCount(t) > 0 ? 0.652 : 0.65)),
    });
    const c = (await jury(engine, id)).find((s) => s.scope === 'chapter')!;
    expect(c.rounds).toHaveLength(2);
    expect(c.status).toBe('accepte_avec_reserves');
    expect(c.reasons[0]).toContain('plateau');
    await engine.close();
  });

  it('nombre maximal de rondes : progression régulière mais insuffisante → accepté avec réserves après rondesMaxParChapitre', async () => {
    const { engine, id } = await runMission({
      withJury: true,
      brief: {
        execution: {
          parallelism: 3,
          rondesMaxParChapitre: 2,
          rondesMaxGlobales: 2,
          profondeurRecherche: 'normale',
          preferenceSources: 'toutes',
          preset: 'equilibre',
          budgetMaxUsd: 12,
        },
      },
      respond: jurors((t) => 0.6 + 0.015 * sigCount(t)),
    });
    const c = (await jury(engine, id)).find((s) => s.scope === 'chapter')!;
    expect(c.rounds).toHaveLength(3); // évaluations 0, 1, 2 : deux rondes de révision
    expect(c.status).toBe('accepte_avec_reserves');
    expect(c.reasons[0]).toContain('maximal');
    const nRev = engine.db
      .prepare(
        "SELECT COUNT(DISTINCT round) AS n FROM revision_log WHERE mission_id=? AND scope='chapter' AND kind='revision'",
      )
      .get(id) as { n: number };
    expect(nRev.n).toBe(2);
    await engine.close();
  });

  it('écart de plus de 4 points entre jurés : justification croisée du président avant de trancher', async () => {
    const { engine, mock, id } = await runMission({
      withJury: true,
      respond: jurors((_t, role) =>
        role === 'methodologist' ? 0.95 : role === 'form' ? 0.5 : 0.8,
      ),
    });
    expect(mock.calls.some((c) => c.meta?.label === 'jury:justification')).toBe(true);
    const c = (await jury(engine, id)).find((s) => s.scope === 'chapter')!;
    expect(c.rounds[0]!.crossJustification).toContain('simulé');
    await engine.close();
  });

  it('un juré inexploitable est écarté (avertissement), les autres décident ; tous inexploitables → échec explicite', async () => {
    const bad = (req: LlmRequest) =>
      req.meta?.label === 'jury:juror_form' ? 'pas du JSON' : undefined;
    const { engine, id, summary } = await runMission({ withJury: true, respond: bad });
    expect(summary.status).toBe('completed');
    const c = (await jury(engine, id)).find((s) => s.scope === 'chapter')!;
    expect(c.rounds[0]!.jurors.map((j) => j.role)).toEqual([
      'juror_methodologist',
      'juror_specialist',
    ]);
    expect(
      engine.journal
        .list(id, 2000)
        .some((e) => e.messageFr.includes('n’a pas rendu d’évaluation exploitable')),
    ).toBe(true);
    await engine.close();
    const all = await runMission({
      withJury: true,
      respond: (req) => (req.meta?.label?.startsWith('jury:juror_') ? 'pas du JSON' : undefined),
    });
    expect(all.summary.status).toBe('failed');
    await all.engine.close();
  });

  it('remarque sur une section inconnue : ignorée par le code, jamais appliquée au hasard', async () => {
    const ghost: Respond = (req) => {
      if (!req.meta?.label?.startsWith('jury:juror_')) return undefined;
      const base = JSON.parse(juryMockRespond(req) as string) as {
        remarques: { section_id: string }[];
      };
      base.remarques.forEach((r) => (r.section_id = 'S99'));
      return JSON.stringify(base);
    };
    const { engine, id } = await runMission({ withJury: true, respond: ghost });
    const c = (await jury(engine, id)).find((s) => s.scope === 'chapter')!;
    expect(c.rounds[0]!.plan).toEqual([]);
    expect(c.status).toBe('accepte_avec_reserves'); // rien à réviser
    expect(c.reasons[0]).toContain('aucune révision possible');
    await engine.close();
  });

  it('reprise : une boucle interrompue (crédit épuisé pendant la révision) reprend sans refaire l’évaluation déjà faite', async () => {
    const { engine, mock, id } = await runMission({ withJury: false });
    const chapter = engine.outline
      .list(id)
      .find((n) => n.level === 'chapitre' && n.kind === 'corps')!;
    const orig = engine.writer.reviseSection.bind(engine.writer);
    let first = true;
    engine.writer.reviseSection = async (...a: Parameters<typeof orig>) => {
      if (first) {
        first = false;
        throw new AppError('E_NO_CREDIT');
      }
      return orig(...a);
    };
    await expect(engine.jury.reviewChapter(id, chapter.id)).rejects.toMatchObject({
      code: 'E_NO_CREDIT',
    });
    const presidents = () => mock.calls.filter((c) => c.meta?.label === 'jury:president').length;
    expect(presidents()).toBe(1);
    const r = await engine.jury.reviewChapter(id, chapter.id);
    expect(r.status).toBe('valide');
    expect(presidents()).toBe(2); // l'évaluation 0 n'a pas été refaite
    // déjà terminé : rien ne se refait
    const n = mock.calls.length;
    await engine.jury.reviewChapter(id, chapter.id);
    expect(mock.calls.length).toBe(n);
    await engine.close();
  });
});

describe('P7 — harmonisation, évaluation globale, mise à jour finale (§13.5)', () => {
  it('modifications ciblées contrôlées par le code (une appliquée, deux écartées), évaluation globale, introduction / conclusion / résumé mis à jour', async () => {
    const { engine, id } = await runMission({
      withJury: true,
      brief: {
        liminaires: {
          pageGarde: true,
          sommaire: true,
          dedicace: true,
          remerciements: true,
          sigles: true,
          listeTableaux: true,
          listeFigures: true,
          resume: true,
          abstract: true,
          avertissement: false,
        },
      },
    });
    const scopes = await jury(engine, id);
    const g = scopes.find((s) => s.scope === 'global')!;
    expect(g.harmonisation).toHaveLength(1);
    expect(g.harmonisation[0]!.remarks[0]).toContain('transition');
    expect(g.rounds.length).toBeGreaterThanOrEqual(1);
    expect(g.status).toBe('valide');
    expect(g.threshold).toBe(14);
    const ev = engine.journal.list(id, 2000).map((e) => e.messageFr);
    expect(
      ev.some((m) =>
        m.includes('Harmonisateur : 1 modification(s) ciblée(s) appliquée(s), 2 écartée(s)'),
      ),
    ).toBe(true);
    // la phrase de transition est ajoutée sans toucher aux citations ; l'ancienne version est conservée
    const nodeId = g.harmonisation[0]!.nodeId;
    const cur = await ask<SectionDraftDetail>(engine, 'getSectionDraft', { nodeId });
    expect(cur.markdown).toContain('Cette partie prépare la suite du raisonnement.');
    expect(cur.markdown).not.toContain('[@A1]');
    expect(cur.claims.length).toBeGreaterThan(0); // affirmations conservées
    // mise à jour finale : introduction et conclusion en version 2, résumé réécrit
    const list = await drafts(engine, id);
    for (const s of list.filter((x) => x.kind !== 'corps')) expect(s.version).toBe(2);
    const vers = await ask<SectionVersionSummary[]>(engine, 'listSectionVersions', {
      nodeId: list.find((x) => x.kind === 'introduction')!.nodeId,
    });
    expect(vers[1]!.changeSummary).toContain('Mise à jour');
    const outcome = engine.db
      .prepare("SELECT status FROM review_outcomes WHERE mission_id=? AND scope='global'")
      .get(id);
    expect(outcome).toEqual({ status: 'valide' });
    await engine.close();
  });

  it('rondesMaxGlobales = 0 : pas d’évaluation globale (l’harmonisation a lieu)', async () => {
    const { engine, id } = await runMission({
      withJury: true,
      brief: {
        execution: {
          parallelism: 3,
          rondesMaxParChapitre: 3,
          rondesMaxGlobales: 0,
          profondeurRecherche: 'normale',
          preferenceSources: 'toutes',
          preset: 'equilibre',
          budgetMaxUsd: 12,
        },
      },
    });
    const g = (await jury(engine, id)).find((s) => s.scope === 'global');
    expect(g?.rounds ?? []).toHaveLength(0);
    expect(g?.harmonisation).toHaveLength(1);
    await engine.close();
  });

  it('jamais plus d’appels simultanés que le parallélisme, même avec trois jurés par chapitre', async () => {
    const { engine, mock } = await runMission({ withJury: true, delayMs: 2 });
    expect(mock.maxConcurrent).toBeLessThanOrEqual(3);
    expect(mock.maxConcurrent).toBeGreaterThan(1);
    await engine.close();
  });
});
