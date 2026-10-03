import { describe, it, expect } from 'vitest';
import {
  AppError,
  defaultBrief,
  type FieldAnalysisView,
  type SectionDraftDetail,
  type SectionChecks,
  type FrontMatterView,
} from '@emilio/shared';
import { EngineService, writingMockRespond, loadSectionSources } from '../src';

import { runMission, ask, drafts, type Respond } from './pipeline';

describe('rédaction P5 (mode simulé) — bout en bout', () => {
  it('rédige chaque section, l’introduction et la conclusion, les pages liminaires ; contrôles d’intégrité tous propres', async () => {
    const { engine, id, summary } = await runMission({
      brief: { liminaires: { ...defaultBrief().liminaires!, abstract: true } },
    });
    expect(summary.status).toBe('completed');
    const list = await drafts(engine, id);
    expect(list.length).toBeGreaterThan(10);
    for (const s of list) {
      expect(s.version, s.title).toBe(1);
      expect(s.status).toBe('in_review');
      // ±10 % de la cible (§9 P5.3)
      expect(Math.abs((s.words ?? 0) - s.wordsTarget) / s.wordsTarget, s.title).toBeLessThanOrEqual(
        0.1,
      );
      expect(s.removed).toBe(0);
    }
    expect(
      list
        .filter((s) => s.kind !== 'corps')
        .map((s) => s.kind)
        .sort(),
    ).toEqual(['conclusion', 'introduction']);

    // Section du corps : marqueurs convertis en identifiants réels de sources vérifiées, ancrage, résumé.
    const body = list.find((s) => s.kind === 'corps')!;
    const d = await ask<SectionDraftDetail>(engine, 'getSectionDraft', { nodeId: body.nodeId });
    expect(d.markdown).not.toMatch(/\[@A\d+/);
    const ids = [...d.markdown.matchAll(/\[@([0-9a-f-]{36})/g)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThan(0);
    for (const sid of new Set(ids)) {
      const st = engine.db
        .prepare('SELECT verification_status AS v, type FROM sources WHERE id=?')
        .get(sid) as { v: string; type: string };
      expect(['verified', 'partially_verified']).toContain(st.v);
      expect(st.type).not.toBe('document_interne');
    }
    expect(Object.keys(d.sources).length).toBeGreaterThan(0);
    expect(d.claims.length).toBeGreaterThan(0);
    expect(d.claims.every((c) => c.supportLevel === 'supported' && c.excerpt)).toBe(true);
    expect(d.checks).toMatchObject({ groundingRate: 1, groundingRateInitial: 1, rounds: 0 });
    expect(d.summary!.split(/\s+/).length).toBeGreaterThanOrEqual(120);
    expect(d.summary!.split(/\s+/).length).toBeLessThanOrEqual(260);
    const row = engine.db
      .prepare(
        'SELECT chunk_id FROM claims c JOIN drafts d ON d.id=c.draft_id WHERE d.outline_node_id=? LIMIT 1',
      )
      .get(body.nodeId) as { chunk_id: string | null };
    expect(row).toBeTruthy();

    // Introduction / conclusion : aucune citation, aucune affirmation sourcée (§9 P5, J6 ADR).
    for (const g of list.filter((s) => s.kind !== 'corps')) {
      const gd = await ask<SectionDraftDetail>(engine, 'getSectionDraft', { nodeId: g.nodeId });
      expect(gd.markdown).not.toMatch(/\[@/);
      expect(gd.claims).toHaveLength(0);
      expect(gd.markdown).toContain('####');
    }

    // Pages liminaires : résumé et abstract rédigés ; dédicace / remerciements jamais inventés (§7.2).
    const fm = await ask<FrontMatterView[]>(engine, 'getFrontMatter', { id });
    const by = Object.fromEntries(fm.map((f) => [f.key, f]));
    expect(by.resume).toMatchObject({ kind: 'genere' });
    expect(by.abstract!.markdown).toContain('Keywords');
    expect(by.dedicace).toMatchObject({ kind: 'a_completer' });
    expect(by.dedicace!.markdown).toContain('[À COMPLÉTER');
    expect(by.remerciements!.markdown).toContain('[À COMPLÉTER');

    // Journal en français, une ligne par section.
    const ev = engine.journal.list(id, 800).map((e) => e.messageFr);
    expect(ev.filter((m) => m.startsWith('Rédacteur : section ')).length).toBe(list.length);
    expect(ev.some((m) => m.includes("Étapes disponibles terminées (jusqu'à P7)"))).toBe(true);
    await engine.close();
  });

  it('parallélisme : jamais plus d’agents que configuré ; la rédaction suit la recherche de la section', async () => {
    const { engine, mock, id } = await runMission({ delayMs: 3 });
    expect(mock.maxConcurrent).toBeLessThanOrEqual(3);
    // ordre : pour chaque section, la tâche de recherche se termine avant sa rédaction
    const rows = engine.db
      .prepare(
        `SELECT t.input_json AS i, t.phase AS p, t.finished_at AS f FROM tasks t WHERE t.mission_id=? AND t.phase IN ('P3','P5')`,
      )
      .all(id) as { i: string; p: string; f: string }[];
    const done = (phase: string, nodeId: string) =>
      rows.find((r) => r.p === phase && (JSON.parse(r.i) as { nodeId?: string }).nodeId === nodeId)
        ?.f;
    const list = await drafts(engine, id);
    for (const s of list.filter((x) => x.kind === 'corps')) {
      const a = done('P3', s.nodeId);
      const b = done('P5', s.nodeId);
      expect(a && b && a <= b, s.title).toBe(true);
    }
    await engine.close();
  });

  it('reprise idempotente : relancer la rédaction d’une section déjà écrite ne crée pas de nouvelle version', async () => {
    const { engine, id, mock } = await runMission();
    const list = await drafts(engine, id);
    const n = mock.calls.length;
    const first = list.find((s) => s.kind === 'corps')!;
    const r = await engine.writer.writeSection(id, first.nodeId);
    expect(r).toMatchObject({ skipped: true, version: 1 });
    expect(mock.calls.length).toBe(n);
    const v = engine.db
      .prepare('SELECT COUNT(*) AS n FROM drafts WHERE outline_node_id=?')
      .get(first.nodeId) as { n: number };
    expect(v.n).toBe(1);
    await engine.close();
  });
});

describe('contrôles d’intégrité pendant la rédaction (§12)', () => {
  /** Rédacteur truqué : une phrase saine puis une phrase fautive de chaque type, sur toutes les sections du corps. */
  const tricky =
    (opts: { correct: 'fix' | 'ignore' }): Respond =>
    (req) => {
      const label = req.meta?.label;
      const prompt = req.messages[0]!.content;
      if (label === 'redaction:section') {
        const good = JSON.parse(writingMockRespond(req)!) as {
          markdown: string;
          claims: unknown[];
        };
        const ex = /^\[E1\] \(source (A\d+)(?:, p\. ([^)]*))?\) (.+)$/m.exec(prompt);
        if (!ex) return JSON.stringify(good);
        const bad = [
          'Un fait inventé de toutes pièces [@A99, p. 4].',
          `Selon la source, le taux atteint 87 % des ménages [@${ex[1]}].`,
          `Les auteurs écrivent « une phrase qui ne figure nulle part dans la source » [@${ex[1]}].`,
          `${ex[3]!.split(/\s+/).slice(0, 12).join(' ')} [@${ex[1]}].`,
          `La microfinance guérit toutes les maladies tropicales de l’Afrique [@${ex[1]}].`,
        ];
        return JSON.stringify({
          ...good,
          markdown: `${good.markdown}\n\n${bad.join(' ')}`,
          mots: 0,
        });
      }
      if (label === 'redaction:correction' && opts.correct === 'ignore') {
        const md = /Texte actuel :\n([\s\S]*?)\n\nProblèmes à corriger/.exec(prompt)?.[1] ?? '';
        return JSON.stringify({ markdown: md, claims: [], mots: 0, manques: [] });
      }
      return undefined;
    };
  const targetBody = async (e: EngineService, id: string) =>
    (await drafts(e, id)).filter((s) => s.kind === 'corps');

  it('correction ciblée qui fonctionne : les phrases fautives disparaissent, une ronde suffit, rien n’est « supprimé par le code »', async () => {
    const { engine, id } = await runMission({ respond: tricky({ correct: 'fix' }) });
    const sec = (await targetBody(engine, id))[0]!;
    const d = await ask<SectionDraftDetail>(engine, 'getSectionDraft', { nodeId: sec.nodeId });
    expect(d.markdown).not.toContain('inventé de toutes pièces');
    expect(d.markdown).not.toContain('87 %');
    expect(d.markdown).not.toContain('ne figure nulle part');
    expect(d.markdown).not.toContain('maladies tropicales');
    expect(d.checks!.rounds).toBe(1);
    expect(d.checks!.removed).toEqual([]);
    expect(d.checks!.groundingRateInitial).toBeLessThan(1);
    expect(d.checks!.groundingRate).toBe(1);
    await engine.close();
  });

  it('correction qui échoue : deux rondes puis suppression par le code, avec la raison de chaque phrase, taux d’ancrage initial et final distincts', async () => {
    const { engine, id } = await runMission({ respond: tricky({ correct: 'ignore' }) });
    const sec = (await targetBody(engine, id))[0]!;
    const d = await ask<SectionDraftDetail>(engine, 'getSectionDraft', { nodeId: sec.nodeId });
    const c = d.checks as SectionChecks;
    expect(c.rounds).toBe(2);
    const reasons = c.removed.map((r) => r.reasonFr).join(' | ');
    expect(reasons).toContain('source non citable ou inconnue');
    expect(reasons).toContain('nombre absent des sources');
    expect(reasons).toContain('citation absente du texte de la source');
    expect(reasons).toContain('passage recopié');
    expect(reasons).toContain('non étayée');
    expect(d.markdown).not.toContain('87 %');
    expect(d.markdown).not.toContain('maladies tropicales');
    expect(c.groundingRateInitial!).toBeLessThan(1);
    expect(c.groundingRate).toBe(1);
    expect(c.warnings.some((w) => w.includes('supprimée(s)'))).toBe(true);
    const summary = (await drafts(engine, id)).find((s) => s.nodeId === sec.nodeId)!;
    expect(summary.removed).toBe(c.removed.length);
    // jamais de marqueur vers une source inconnue dans le texte conservé
    expect(d.markdown).not.toMatch(/\[@A\d+/);
    await engine.close();
  });

  it('un verdict manquant du vérificateur n’est jamais un « soutenu » par défaut', async () => {
    const { engine, id } = await runMission({
      respond: (req) =>
        req.meta?.label === 'redaction:ancrage' ? JSON.stringify({ verdicts: [] }) : undefined,
    });
    const sec = (await targetBody(engine, id))[0]!;
    const d = await ask<SectionDraftDetail>(engine, 'getSectionDraft', { nodeId: sec.nodeId });
    // toutes les affirmations sourcées sont jugées non étayées (taux initial 0), corrigées puis écartées : rien de sourcé ne reste
    expect(d.checks!.groundingRateInitial).toBe(0);
    expect(d.checks!.rounds).toBeGreaterThanOrEqual(1);
    expect(d.claims).toHaveLength(0);
    await engine.close();
  });

  it('longueur hors tolérance : signalée en avertissement après les rondes de correction', async () => {
    const { engine, id } = await runMission({
      respond: (req) => {
        if (req.meta?.label !== 'redaction:section' && req.meta?.label !== 'redaction:correction')
          return undefined;
        return JSON.stringify({
          markdown: 'Un texte bien trop court pour la cible demandée.',
          claims: [],
          mots: 9,
          manques: [],
        });
      },
    });
    const sec = (await targetBody(engine, id))[0]!;
    const d = await ask<SectionDraftDetail>(engine, 'getSectionDraft', { nodeId: sec.nodeId });
    expect(d.checks!.warnings.some((w) => w.includes('développe'))).toBe(true);
    expect(d.checks!.rounds).toBe(2);
    await engine.close();
  });

  it('section sans source vérifiée : le rédacteur ne reçoit aucune source et le texte porte [INFORMATION MANQUANTE]', async () => {
    // Services bibliographiques injoignables : aucune source retenue pour les sections.
    const { engine, mock, id } = await runMission({
      setup: (e) =>
        e.mockSources.forEach((c) => {
          c.search = async () => {
            throw new AppError('E_NETWORK');
          };
        }),
    });
    const sec = (await targetBody(engine, id))[0]!;
    const d = await ask<SectionDraftDetail>(engine, 'getSectionDraft', { nodeId: sec.nodeId });
    const call = mock.calls.find((c) => c.meta?.label === 'redaction:section')!;
    expect(call.messages[0]!.content).toContain('aucune source disponible');
    expect(d.markdown).toContain('[INFORMATION MANQUANTE');
    expect(d.claims).toHaveLength(0);
    await engine.close();
  });

  it('budget de contexte (§8.4) : extraits réduits quand le budget baisse ; budget déduit de la fenêtre du modèle (70 %)', async () => {
    const { engine, id } = await runMission();
    const node = engine.outline
      .list(id)
      .find(
        (n) => n.kind === 'corps' && !engine.outline.list(id).some((c) => c.parentId === n.id),
      )!;
    const cfg = engine.writer['d'].cfg;
    const load = (maxTokens: number) =>
      loadSectionSources(
        { db: engine.db, store: engine.store, embedder: engine.embedder, cfg },
        { missionId: id, node, maxTokens },
      );
    const wide = await load(12000);
    const narrow = await load(150);
    expect(wide.extracts.length).toBeGreaterThan(narrow.extracts.length);
    expect(narrow.extracts.length).toBeGreaterThanOrEqual(1);
    // une source sans extrait restant n'est plus citable
    expect(
      [...narrow.sources.keys()].every((a) => narrow.extracts.some((e) => e.sourceAlias === a)),
    ).toBe(true);
    // fenêtre du modèle : jamais plus de 12 000 jetons, jamais plus de 70 % de la fenêtre moins l'amorce
    const maxTok = (len: number | null) => {
      engine.settings.set('openrouter_models_cache', {
        models: len
          ? [
              {
                id: 'simule/modele-de-demonstration',
                name: 'x',
                contextLength: len,
                promptPrice: 0,
                completionPrice: 0,
              },
            ]
          : [],
      });
      return (
        engine.writer as unknown as { maxExtractTokens(id: string): number }
      ).maxExtractTokens(id);
    };
    expect(maxTok(null)).toBe(12000);
    expect(maxTok(1_000_000)).toBe(12000);
    expect(maxTok(16000)).toBe(Math.floor(16000 * 0.7) - 6000);
    expect(maxTok(4000)).toBe(2000);
    await engine.close();
  });
});

describe('analyse des données de terrain P4 (mode simulé)', () => {
  it('le code calcule, le modèle choisit et interprète ; tableaux numérotés et sourcés ; analyse invalide écartée ; chiffres inventés écartés', async () => {
    const { engine, id, summary } = await runMission({ data: true });
    expect(summary.status).toBe('completed');
    const a = await ask<FieldAnalysisView>(engine, 'getFieldAnalysis', { id });
    expect(a.respondents).toBe(60);
    expect(a.fileName).toBe('donnees-enquete.csv');
    // numérotation continue, légende « Tableau N : … », source « enquête de terrain »
    expect(a.tables.map((t) => t.tableNumber)).toEqual(a.tables.map((_, i) => i + 1));
    for (const t of a.tables) {
      expect(t.caption).toMatch(new RegExp(`^Tableau ${t.tableNumber} : `));
      expect(t.source).toMatch(/^Source : enquête de terrain, /);
      expect(t.rows.length).toBeGreaterThan(0);
    }
    // analyse « Variable inexistante » du plan simulé : écartée par le code, signalée
    expect(
      a.warnings.some((w) => w.includes('Variable inexistante') && w.includes('écartée')),
    ).toBe(true);
    // fréquences : effectifs et pourcentages exacts sur les 60 réponses
    const freq = a.tables.find((t) => t.caption.includes('Répartition'))!;
    const total = freq.rows.at(-1)!;
    expect(total[0]).toBe('Total');
    expect(total[1]!.replace(/\s/g, '')).toBe('60');
    expect(freq.facts[0]).toMatch(/n = 60/);
    // l'interprétation simulée contient « 87 % » (invention) : phrase écartée (§12.3)
    expect(a.sentencesDropped).toBeGreaterThanOrEqual(1);
    expect(a.interpretation).not.toContain('87');
    expect(a.interpretation).toContain('[A1]');
    // hypothèses : une entrée par hypothèse du brief
    expect(a.hypotheses).toHaveLength(2);
    expect(a.hypotheses[0]!.hypothese).toBe('Le crédit solidaire améliore l’accès au crédit.');
    // figures numérotées, rendues plus tard (J8)
    expect(a.tables.some((t) => t.figure?.caption.startsWith('Figure 1 : '))).toBe(true);
    await engine.close();
  });

  it('les sections de résultats reçoivent les résultats calculés et un jeton de tableau ; leurs chiffres sont autorisés', async () => {
    const { engine, mock, id } = await runMission({ data: true });
    const call = mock.calls
      .filter((c) => c.meta?.label === 'redaction:section')
      .find((c) => c.messages[0]!.content.includes('Résultats de terrain calculés'))!;
    expect(call).toBeTruthy();
    const list = await drafts(engine, id);
    const withToken: string[] = [];
    for (const s of list.filter((x) => x.kind === 'corps')) {
      const d = await ask<SectionDraftDetail>(engine, 'getSectionDraft', { nodeId: s.nodeId });
      if (d.markdown.includes('{{TABLEAU:A1}}')) withToken.push(s.title);
      expect(d.checks!.removed, s.title).toEqual([]);
    }
    expect(withToken.length).toBeGreaterThan(0);
    await engine.close();
  });

  it('un test non significatif ne peut pas « confirmer » une hypothèse : le code la ramène à « nuancée »', async () => {
    const { engine, id } = await runMission({
      data: true,
      respond: (req) => {
        if (req.meta?.label !== 'analyse:interpretation') return undefined;
        const prompt = req.messages[0]!.content;
        const ns = [...prompt.matchAll(/^(A\d+) \(Tableau \d+\) : .*non significative.*$/gm)].map(
          (m) => m[1]!,
        );
        return JSON.stringify({
          interpretation: 'Le test ne met pas en évidence de lien [A1].',
          hypotheses: [
            {
              hypothese: 'H1',
              statut: 'confirmee',
              analyses: ns.slice(0, 1),
              justification: 'Il y a bien un lien.',
            },
            { hypothese: 'H2', statut: 'confirmee', analyses: [], justification: 'Sans appui.' },
          ],
          limites: [],
          manques: [],
        });
      },
    });
    const a = await ask<FieldAnalysisView>(engine, 'getFieldAnalysis', { id });
    const h = a.hypotheses;
    expect(h.map((x) => x.statut)).toEqual(['nuancee', 'nuancee']);
    expect(h[0]!.note).toContain('non significatif');
    expect(h[1]!.note).toContain('Aucune analyse citée');
    await engine.close();
  });

  it('approche empirique sans données : sections de résultats remplacées par des emplacements, aucune donnée inventée', async () => {
    const { engine, mock, id, summary } = await runMission({ brief: { approche: 'quantitative' } });
    expect(summary.status).toBe('completed');
    const list = await drafts(engine, id);
    const ph = list.filter((s) => s.placeholder);
    expect(ph.length).toBeGreaterThan(0);
    for (const s of ph) {
      const d = await ask<SectionDraftDetail>(engine, 'getSectionDraft', { nodeId: s.nodeId });
      expect(d.markdown).toContain('[DONNÉES À INSÉRER');
      expect(d.markdown).not.toMatch(/\d{2,}/);
      expect(d.claims).toHaveLength(0);
    }
    // aucun appel au rédacteur pour ces sections
    const called = mock.calls.filter((c) => c.meta?.label === 'redaction:section').length;
    expect(called).toBe(list.filter((s) => s.kind === 'corps').length - ph.length);
    // la conclusion le dit
    const concl = mock.calls.find(
      (c) =>
        c.meta?.label === 'redaction:general' &&
        c.messages[0]!.content.includes('conclusion générale'),
    )!;
    expect(concl.messages[0]!.content).toContain('Aucune donnée de terrain n’a été fournie');
    expect(await ask<FieldAnalysisView | null>(engine, 'getFieldAnalysis', { id })).toBeNull();
    await engine.close();
  });
});
